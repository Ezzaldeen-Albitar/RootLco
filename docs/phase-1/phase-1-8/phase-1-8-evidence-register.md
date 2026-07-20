# Phase 1-8 — Evidence Register

**Base:** `origin/develop` = `ca5273f` (after Phase 1-7 closure). **Branch:**
`feature/p1-08-appointment-reception-database`.

## Commit ledger (feature branch, oldest → newest)

| SHA           | Wave | Summary                                                                              |
| ------------- | ---- | ------------------------------------------------------------------------------------ |
| `b8f3877`     | 2    | reserve `apt` + `rec` module schemas + registration surface                          |
| `a1d5e8d`     | 2    | appointment dual-scope configuration catalogs                                        |
| `749e80b`     | 2    | branch-scoped `apt.appointments` master (DB-001/005/014)                             |
| `4e0337c`     | 2    | appointment services + append-only status history (DB-002/003)                       |
| `4e57a5d`     | 3    | reception origin + visit foundation (DB-004..008)                                    |
| `c82287e`     | 4    | complaints, inspection, damage, observations, contents (DB-009..016)                 |
| `269cf86`     | 5    | signatures, refusals, authorization, custody, status + atomic check-in (DB-017..022) |
| `310e367`     | 6    | classification stack, auto-enumerated security, concurrency ×5                       |
| _this commit_ | 7    | documentation package + clean-room evidence                                          |

## Verified counts (live catalog at Wave 7)

| Metric         | Value                                       |
| -------------- | ------------------------------------------- |
| Tables         | 29 (6 `apt` + 23 `rec`)                     |
| Functions      | 19                                          |
| Triggers       | 67                                          |
| Policies       | 81                                          |
| Indexes        | 133                                         |
| Columns        | 454 (4 restricted, 0 restricted-searchable) |
| Migrations     | 17 (`20260721090000`..`20260721106000`)     |
| P1-08 DB tests | 118                                         |
| Full DB suite  | 85 files / 958 tests green                  |

## Gate checklist (evidenced)

- [x] Every P1-08 DB task implemented, registered, documented, tested.
- [x] No FK-index gaps; no duplicate indexes on `apt`/`rec`.
- [x] All 454 columns classified; validator green in CI.
- [x] No-fake-data: business tables empty after clean migration; seeds idempotent.
- [x] Append-only ledgers reject UPDATE/DELETE; forged/incoherent rows rejected.
- [x] Concurrency single-winner races proven ×5.
- [x] No work-order table (P1-09); no backend (P1-18); no frontend (P1-28).
- [x] Feature PR **#36** merged into `develop` — merge commit `6e5e56a` (parents `ca5273f` + `e7ba638`), merge-commit strategy, 2026-07-19T23:10:28+03:00; feature SHA `e7ba638` contained in `origin/develop` (`6e5e56a`).
- [x] Hosted CI green on the final feature SHA `e7ba638` — all four required checks passed.

## Reconciliation notes

- Migration `0002_base_schemas.sql` did not pre-reserve `apt`/`rec` (only
  org/iam/shared/crm/veh); this phase creates them as a controlled schema
  addition, consistent with the "one schema per module" rule.
- Dev helpers (`_apply.mjs`, `_q.mjs`) used during development were **never
  committed** and were removed before clean-room validation.

## Review model

Owner-authorized technical, QA, security, and adversarial self-review under the
Solo Developer Review Policy and the Standing Technical Authorization Policy —
**not** an independent third-party review.
