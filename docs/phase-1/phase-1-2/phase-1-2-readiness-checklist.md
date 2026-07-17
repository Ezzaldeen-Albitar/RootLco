# Phase 1-2 Readiness Checklist

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-2 — Database Architecture and Engineering Standards ·
**Date:** 2026-07-16 · **Branch:** `feature/p1-02-database-engineering-foundation` ·
**Review model:** [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
(owner-authorized technical self-review; not independent)

Statuses: **Complete** (done and evidenced) · **Complete-Doc** (deliverable is a
standard/pattern by design) · **Deferred-Recorded** (deliberately not built in Phase 1-2,
recorded with reason) · **Blocked** · **Not executed (disclosed)**.

| #   | Task ID       | Deliverable                                          | Status       | Evidence                                                                                                                                         |
| --- | ------------- | ---------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | P1-02-DB-001  | Database naming standard                             | Complete     | [database-naming-standard.md](../../database/database-naming-standard.md); practised by migrations 0001–0003; naming asserted in tests           |
| 2   | P1-02-DB-002  | Schema strategy (org/iam/shared/crm/veh)             | Complete     | Migration `0002_base_schemas.sql`; foundation tests verify the five schemas; [database-architecture.md](../../database/database-architecture.md) |
| 3   | P1-02-DB-003  | UUID standard                                        | Complete     | `gen_random_uuid()` defaults in 0003; UUID rules in the architecture document §UUID; no extension needed (recorded honestly)                     |
| 4   | P1-02-DB-004  | Display-number strategy                              | Complete     | `shared.number_sequences` (0003); [number-sequence-standard.md](../../database/number-sequence-standard.md)                                      |
| 5   | P1-02-DB-005  | Scope-column and composite-FK standard               | Complete     | Architecture doc; composite-FK template proven positive+negative in `tests/db/constraints.test.ts` (disposable fixtures)                         |
| 6   | P1-02-DB-006  | Base audit/metadata standard                         | Complete     | `shared.touch_row_metadata()` (0002) applied in 0003; record_version advance verified by tests                                                   |
| 7   | P1-02-DB-007  | Optimistic concurrency / versioning standard         | Complete     | [transaction-and-concurrency-standard.md](../../database/transaction-and-concurrency-standard.md); expected-version template                     |
| 8   | P1-02-DB-008  | Soft-delete, archive, status-history standards       | Complete     | Architecture doc sections; partial-unique + append-only history fixtures proven in tests (UPDATE/DELETE denied to runtime)                       |
| 9   | P1-02-DB-009  | Data-type standard                                   | Complete     | Architecture doc data-type section; numeric-for-money mandated; no float money anywhere                                                          |
| 10  | P1-02-DB-010  | Index standard                                       | Complete     | Architecture/naming docs; tenant-leading `uq_number_sequences_scope`; index-name assertions in tests                                             |
| 11  | P1-02-DB-011  | Constraint standard (CHECK/partial-unique/EXCLUDE)   | Complete     | Templates + positive/negative proofs in `tests/db/constraints.test.ts` (23503/23505/23P01/23514)                                                 |
| 12  | P1-02-DB-012  | Transaction and concurrency standard                 | Complete     | Standard doc; FOR UPDATE serialisation verified by the 50-worker test                                                                            |
| 13  | P1-02-DB-013  | Idempotency storage pattern                          | Complete-Doc | Pattern DDL + semantics pinned by `tests/db/patterns.test.ts`; permanent table deliberately deferred (no business operation exists)              |
| 14  | P1-02-DB-014  | Migration standard                                   | Complete     | [migration-standard.md](../../database/migration-standard.md); immutability CI assertion; defective-migration rehearsal recorded                 |
| 15  | P1-02-DB-015  | Seed standard                                        | Complete     | [seed-standard.md](../../database/seed-standard.md); `supabase/seed.sql` remains empty of rows                                                   |
| 16  | P1-02-DB-016  | Retention standard                                   | Complete     | [retention-and-sensitive-data-standard.md](../../database/retention-and-sensitive-data-standard.md)                                              |
| 17  | P1-02-DB-017  | PostgreSQL extension register + migration 0001       | Complete     | [postgresql-extension-register.md](../../database/postgresql-extension-register.md); 0001 applied to clean DB; versions measured                 |
| 18  | P1-02-DB-018  | Base schema and role migration 0002                  | Complete     | 0002 applied; role attributes asserted by tests (non-owner, NOBYPASSRLS)                                                                         |
| 19  | P1-02-DB-019  | Safe allocation function                             | Complete     | `shared.next_display_number()` (0003); concurrency, rollback, widening-pad, narrowing all test-proven                                            |
| 20  | P1-02-DB-020  | Database test-fixture standard                       | Complete     | [database-test-fixtures.md](../../testing/database-test-fixtures.md); implemented by `tests/db/helpers.ts`                                       |
| 21  | P1-02-SEC-001 | RLS standard, default deny, FORCE                    | Complete     | [rls-standard.md](../../database/rls-standard.md); 16 RLS tests as runtime role                                                                  |
| 22  | P1-02-SEC-002 | Session-context contract                             | Complete     | `app.*` contract + iam readers (0002); transaction-locality proven by test                                                                       |
| 23  | P1-02-SEC-003 | Role model, non-owner runtime, Supabase-role honesty | Complete     | [role-and-grant-standard.md](../../database/role-and-grant-standard.md); measured role attributes recorded                                       |
| 24  | P1-02-SEC-004 | Sensitive-data classification standard               | Complete     | Retention/sensitive-data standard; dictionary carries mandatory classification fields                                                            |
| 25  | P1-02-QA-001  | Clean migration application testing                  | Complete     | `supabase db reset` runs (recorded); CI runner + clean-DB guard; foundation suite                                                                |
| 26  | P1-02-QA-002  | RLS default-deny and isolation tests                 | Complete     | `tests/db/rls.test.ts` — 18 passing tests as non-owner role                                                                                      |
| 27  | P1-02-QA-003  | No-context / runtime-bypass tests                    | Complete     | Same suite: no-context 0 rows; row_security=off errors; ALTER denied                                                                             |
| 28  | P1-02-QA-004  | Constraint template tests (positive and negative)    | Complete     | `tests/db/constraints.test.ts` — 12 passing tests                                                                                                |
| 29  | P1-02-QA-005  | Number-allocation concurrency tests                  | Complete     | 50 parallel workers (approved baseline met — not reduced); mixed rollback consistency; number-sequences suite: 13 passing tests                  |
| 30  | P1-02-DO-001  | Migration validation CI                              | Complete     | `Database migrations and RLS tests` job; defective-migration rehearsal evidence                                                                  |
| 31  | P1-02-DO-002  | Environment separation                               | Complete     | Local Supabase (54322) vs CI service container; separate throwaway credentials; no cloud environments claimed (ADR-012)                          |
| 32  | P1-02-DO-003  | Pipeline failure rehearsal                           | Complete     | [rehearsal-defective-migration.md](./rehearsal-defective-migration.md) — exit 1 observed; defective file never committed                         |
| 33  | P1-02-DOC-003 | Data dictionary                                      | Complete     | [data-dictionary.md](../../database/data-dictionary.md) — schema + populated foundation objects                                                  |
| 34  | P1-02-DOC-*   | Controlled document set + evidence + gate package    | Complete     | 12 standards, initial audit, this checklist, evidence register, completion report, traceability, owner gate                                      |

**Summary: 34 items — 33 Complete · 1 Complete-Doc (by canonical design) · 0 Blocked ·
0 Not executed. The gate decision itself is pending the owners.**

Items that are **not** claimed:

- **No independent review** — everything above is owner-authorized self-review
  (P1-EC-016 remains open).
- **The CI result is owner-stated, not observed here.** At the time this checklist was
  written no GitHub Actions run had executed on the branch, and the locally-run
  equivalents were the only CI evidence. Pull request #5 has since run and merged, and
  the repository administrator states all four mandatory checks passed on its final
  source commit `dae6681`; the authoritative run results live in GitHub Actions and were
  never read from the build environment (no CLI, no token).

**Gate status (updated 2026-07-17):** the Phase 1-2 exit gate recorded
**Go — Technical Gate Passed**; Phase 1-3 is authorized. See
[phase-1-2-owner-gate.md](./phase-1-2-owner-gate.md).
