# Phase 1-9 — Test Catalog

**71 P1-09 database tests across 10 files**, green within the full
`npm run test:db` suite. All isolation assertions run on the non-privileged
`app_runtime` / `app_readonly` login roles; admin (BYPASSRLS) is used only for
fixtures and is never RLS evidence.

| File                              | Tests | Covers                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wo-work-orders.test.ts`          | 14    | Master creation; reception-origin preconditions (status / accepted custody / approved authorization); one-ordinary-per-origin; Vehicle coherence lock; `ordinary`/`rework` kind; state matrix + transition guard; tenant terminal-state CHECK; display-number uniqueness; status-history emit/coherence; RLS |
| `qms-closure-rework.test.ts`      | 9     | Closure gate B1..B6 (independent negatives, `23514`); cancellation bypass still records history; BR-WO-002 terminal-freeze + `qms.attempt_reopen` recorded-and-rejected; BR-QMS-001 independent sign-off; finalized QC frozen; rework link                                                                   |
| `wo-jobs-labor.test.ts`           | 10    | Job lifecycle + assignment-required gate; reassignment reason; labor overlap `EXCLUDE` + ≤1 active; `ended_at` write-once; backdating window; no-labor-on-terminal-WO; correction via `tech.correct_labor_session`; technician profile/skills/operational certs; availability non-overlap                    |
| `dia-diagnostics.test.ts`         | 9     | Template versioning (`draft→published→retired`); published version + items frozen; report pins exact published version; report status; completion gate (mandatory items); findings severity/disposition; measurement unit required; DTC format; evidence exact-version binding + append-only reviews         |
| `wo-services-approvals.test.ts`   | 4     | Service/required-part positive-qty + opaque forward refs; additional-work `state`+`fulfillment_state` + restricted-detail gating; immutable customer approval binding a `rec` party role; append-only approval evidence (exact version)                                                                      |
| `wo-classification-guard.test.ts` | 6     | Classification validator negative fixtures (searchable-restricted, missing, stale, duplicate, invalid class, type-drift) + committed-registry pass                                                                                                                                                           |
| `p1-09-isolation.test.ts`         | 4     | Cross-tenant read **and write** denial across `wo`/`tech`/`dia`/`qms` on non-privileged roles                                                                                                                                                                                                                |
| `p1-09-concurrency.test.ts`       | 4     | Single-winner races ×5 reps: duplicate ordinary WO origin (`23505`), labor overlap (`23P01`), duplicate close (idempotent no-op; one close history row), gap-free display number                                                                                                                             |
| `p1-09-security.test.ts`          | 9     | Auto-enumerated over all 44 tables: RLS enabled+forced, policies present, no DELETE grant, readonly SELECT-only, restricted gate, append-only no-UPDATE, function invoker/`search_path`, worker no-grant, no scope leakage                                                                                   |
| `p1-09-rollback.test.ts`          | 2     | Clean-room from-zero apply of all 16 migrations; business tables empty after apply (only the structural state graph seeded)                                                                                                                                                                                  |

## Shared fixture

`tests/db/p1-09-helpers.ts` provides cascade cleanup and platform-fixture cleanup
for every `wo`/`tech`/`dia`/`qms` table, scope/context helpers, and the
reception-visit + technician-profile fixtures assembled through prior-phase
primitives (so the reception-origin preconditions are satisfied without touching
`rec` internals).

## Cross-cutting guards that also cover P1-09 (not counted above)

`foundation.test.ts` (table/routine/trigger/policy allow-lists, RLS-forced, role
posture), `org-security.test.ts` (FK-index coverage, no duplicate indexes,
tenant-column invariant, no DELETE grant), the no-business-data guard, and
`shared-hardening.test.ts`.
