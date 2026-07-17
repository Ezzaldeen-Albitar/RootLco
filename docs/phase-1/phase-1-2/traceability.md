# Phase 1-2 Traceability Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-2 · **Date:** 2026-07-16 · **Rule:** no implementation without
traceability; no task marked complete merely because a file exists — status lives in the
[readiness checklist](./phase-1-2-readiness-checklist.md) against evidence in the
[evidence register](./phase-1-2-evidence-register.md).

Requirement-register identifiers (FR/NFR/BR) live in the canonical Phase 1 plan
(outside Git by owner decision — see
[canonical-documents.md](../../governance/canonical-documents.md)). This register maps
each P1-02 task to its governing ADRs and its concrete artefacts; the canonical plan's
FR/NFR/BR cross-index is updated in the canonical documents themselves.

| Task ID       | Governing ADR(s) | Migration                   | Test evidence                                                | Standard / documentation                                        |
| ------------- | ---------------- | --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| P1-02-DB-001  | ADR-003, ADR-005 | 0001–0003 (practice)        | naming assertions in `constraints`/`foundation`              | database/database-naming-standard.md                            |
| P1-02-DB-002  | ADR-001, ADR-003 | 0002                        | `foundation` (schemas, ownership)                            | database/database-architecture.md                               |
| P1-02-DB-003  | ADR-003          | 0003 (`gen_random_uuid()`)  | `foundation`, allocator tests                                | database/database-architecture.md (UUID section)                |
| P1-02-DB-004  | ADR-008          | 0003                        | `number-sequences` (13 tests)                                | database/number-sequence-standard.md                            |
| P1-02-DB-005  | ADR-001, ADR-004 | — (template, by design)     | `constraints` composite-FK positive/negative                 | database/database-architecture.md (scope columns)               |
| P1-02-DB-006  | ADR-005          | 0002 (`touch_row_metadata`) | metadata trigger assertions in `number-sequences`            | database/database-architecture.md (base metadata)               |
| P1-02-DB-007  | ADR-005          | 0003 (`record_version`)     | version-advance assertions                                   | database/transaction-and-concurrency-standard.md                |
| P1-02-DB-008  | ADR-004, ADR-005 | — (pattern, by design)      | `patterns` append-only history; `constraints` partial unique | database/database-architecture.md (delete/history)              |
| P1-02-DB-009  | ADR-003          | 0003 (types in practice)    | fixture `numeric(12,3)` CHECK test                           | database/database-architecture.md (data types)                  |
| P1-02-DB-010  | ADR-003, ADR-004 | 0003 (`uq_..._scope`)       | index-prefix assertions                                      | database/database-naming-standard.md + architecture             |
| P1-02-DB-011  | ADR-003          | 0001 (btree_gist)           | `constraints` EXCLUDE/CHECK/partial-unique                   | database/database-architecture.md (constraints)                 |
| P1-02-DB-012  | ADR-005          | 0003 (FOR UPDATE)           | 50-worker + mixed-rollback concurrency                       | database/transaction-and-concurrency-standard.md                |
| P1-02-DB-013  | ADR-005          | deferred (recorded)         | `patterns` idempotency fixture (5 tests)                     | database/transaction-and-concurrency-standard.md (§idempotency) |
| P1-02-DB-014  | ADR-005, ADR-012 | all                         | `foundation` migration-file rules; CI immutability           | database/migration-standard.md                                  |
| P1-02-DB-015  | ADR-008, ADR-009 | seed.sql (empty by design)  | reset runs record seed execution                             | database/seed-standard.md                                       |
| P1-02-DB-016  | ADR-003          | —                           | —                                                            | database/retention-and-sensitive-data-standard.md               |
| P1-02-DB-017  | ADR-003          | 0001                        | `foundation` extension assertions                            | database/postgresql-extension-register.md                       |
| P1-02-DB-018  | ADR-001, ADR-004 | 0002                        | `foundation` role/ownership assertions                       | database/role-and-grant-standard.md                             |
| P1-02-DB-019  | ADR-008          | 0003                        | allocator + concurrency + widening-pad regression            | database/number-sequence-standard.md                            |
| P1-02-DB-020  | ADR-004          | —                           | the harness itself (`tests/db/helpers.ts`)                   | testing/database-test-fixtures.md                               |
| P1-02-SEC-001 | ADR-004          | 0003 (RLS+FORCE)            | `rls` (18 tests, runtime role)                               | database/rls-standard.md                                        |
| P1-02-SEC-002 | ADR-004          | 0002 (iam readers)          | context transaction-locality test                            | database/rls-standard.md (context contract)                     |
| P1-02-SEC-003 | ADR-004          | 0002 (roles/grants)         | role-attribute + no-ownership assertions                     | database/role-and-grant-standard.md                             |
| P1-02-SEC-004 | ADR-003          | —                           | —                                                            | database/retention-and-sensitive-data-standard.md               |
| P1-02-QA-001  | ADR-005          | all                         | 3 clean resets recorded; CI runner + guard                   | evidence register §2                                            |
| P1-02-QA-002  | ADR-004          | 0003                        | `rls` default-deny + A/B isolation                           | evidence register §3                                            |
| P1-02-QA-003  | ADR-004          | 0002/0003                   | no-context, row_security=off, ALTER-denied tests             | evidence register §3                                            |
| P1-02-QA-004  | ADR-003          | 0001 (btree_gist)           | `constraints` 12 positive/negative                           | evidence register §3                                            |
| P1-02-QA-005  | ADR-008          | 0003                        | 50-worker + mixed rollback                                   | evidence register §3                                            |
| P1-02-DO-001  | ADR-012          | —                           | CI `database` job; rehearsal exit codes                      | rehearsal-defective-migration.md                                |
| P1-02-DO-002  | ADR-012          | —                           | local vs CI database matrix                                  | testing/database-test-fixtures.md §1; migration standard        |
| P1-02-DO-003  | ADR-012          | —                           | RUNNER_EXIT=1 / GUARD_EXIT=1                                 | rehearsal-defective-migration.md                                |
| P1-02-DOC-003 | ADR-003, ADR-005 | 0002/0003 (source of truth) | dictionary cross-checked against 0003                        | database/data-dictionary.md                                     |

Companion governance artefacts of this phase: Phase 1-1 gate closure
([phase-1-1-owner-gate.md](../phase-1-1/phase-1-1-owner-gate.md)),
[solo-developer-review-policy.md](../../governance/solo-developer-review-policy.md),
[initial-audit.md](./initial-audit.md), and the branch's logical commit series
(`git log develop..feature/p1-02-database-engineering-foundation`).

## Security-baseline upgrade (owner instruction, 2026-07-17)

| Instruction item                                                                                                                     | Artifact                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Pin ASVS v5.0.0 · Top 10:2025 · API Top 10:2023 · NIST SSDF v1.1 · SAMM v2.0.3                                                       | [security-baseline.md](../../security/security-baseline.md) §2                                    |
| ASVS Level 2 target + selective Level 3 for named high-risk workflows                                                                | [security-baseline.md](../../security/security-baseline.md) §3; recorded per row in the matrix    |
| Full ASVS requirement matrix (required columns; six statuses; evidence-gated Verified)                                               | [owasp-asvs-5-matrix.md](../../security/owasp-asvs-5-matrix.md) — 345 rows from the pinned tag    |
| OWASP Top 10:2025 matrix                                                                                                             | [owasp-top-10-2025-matrix.md](../../security/owasp-top-10-2025-matrix.md)                         |
| OWASP API Security Top 10:2023 matrix                                                                                                | [owasp-api-top-10-2023-matrix.md](../../security/owasp-api-top-10-2023-matrix.md)                 |
| Threat-modeling standard                                                                                                             | [threat-modeling-standard.md](../../security/threat-modeling-standard.md)                         |
| Secure-coding standard                                                                                                               | [secure-coding-standard.md](../../security/secure-coding-standard.md)                             |
| Security-testing standard                                                                                                            | [security-testing-standard.md](../../security/security-testing-standard.md)                       |
| Vulnerability-management standard                                                                                                    | [vulnerability-management-standard.md](../../security/vulnerability-management-standard.md)       |
| Dependency and supply-chain standard                                                                                                 | [dependency-and-supply-chain-standard.md](../../security/dependency-and-supply-chain-standard.md) |
| Security exceptions register (starts empty; required fields defined)                                                                 | [security-exceptions-register.md](../../security/security-exceptions-register.md)                 |
| Security Gate (no Critical; High needs owner-approved time-bounded exception; every applicable control mapped to requirement + test) | [security-baseline.md](../../security/security-baseline.md) §8                                    |
| Database controls implemented and verified with test evidence                                                                        | [security-baseline.md](../../security/security-baseline.md) §9 (RL-SEC-DB-001..014)               |
| No OWASP compliance claim                                                                                                            | [security-baseline.md](../../security/security-baseline.md) §4; every matrix restates it          |
