# Phase 1-9 — Change Log

Chronological by wave. All schema changes are additive and forward-only; no merged
migration was edited.

## Waves

| Wave | Theme                                                              | What landed                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Baseline                                                           | Cut `feature/p1-09-work-order-diagnostics-technician-database` from `origin/develop` = `8881834`; confirmed clean baseline (no `wo`/`tech`/`dia`/`qms` objects).                                                                                       |
| 1    | Design gate + adversarial self-review                              | Fixed [phase-1-9-design.md](phase-1-9-design.md); ran adversarial self-review → 14 findings (1 C, 4 H, 6 M, 3 L), all resolved by binding amendment in [phase-1-9-review-response.md](phase-1-9-review-response.md); reserved the four module schemas. |
| 2    | Work-order foundation                                              | WO + job state/transition catalogs (flag CHECKs, F1); `wo.work_orders` master (reception origin, Vehicle coherence lock, kind); append-only status history.                                                                                            |
| 3    | Jobs, technicians, labor                                           | Technician catalogs + profiles/skills/certs (+restricted detail)/availability; `wo.jobs` + job status history; `wo.job_assignments`; `tech.labor_sessions` (overlap EXCLUDE, correction-linked).                                                       |
| 4    | Services, parts, additional work, approvals                        | WO service/part lines (opaque forward refs); additional-work requests (+restricted detail, `fulfillment_state`); immutable customer approvals + append-only evidence.                                                                                  |
| 5    | Diagnostics                                                        | Diagnostic-type catalog; inspection templates/versions/items (published-frozen); reports (exact-version pin, completion gate); findings/measurements/DTCs/evidence/recommendations/reviews.                                                            |
| 6    | QC, closure gate, reopen, rework                                   | QC-check catalog; quality-control records (finalized-frozen) + per-check results + status history; reopen-attempt ledger; rework links (BR-QMS-001) + restricted cost; the closure gate (B1..B6, BR-WO-002).                                           |
| 7    | Classification, isolation, concurrency, rollback, seeds, CI, tests | Classification registry + validator; auto-enumerated security; isolation; concurrency ×5; rollback/clean-room; structural state-graph seed; CI wiring; the 10 P1-09 test files (71 tests).                                                             |
| 8    | Docs, clean-room, red-team                                         | This `docs/phase-1/phase-1-9/` package; clean-room from-zero apply; red-team pass; owner-gate record left **Pending**.                                                                                                                                 |

## Migrations (16, forward-only)

| Migration | Change                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| `…090000` | Reserve `wo`/`tech`/`dia`/`qms` module schemas; USAGE grants to app roles                       |
| `…091000` | WO + job state/transition catalogs (platform-governed terminal/closed/cancel flag CHECKs)       |
| `…092000` | Technician catalogs (skills, skill levels, certifications)                                      |
| `…093000` | Diagnostic + QC catalogs (diagnostic types, QC checks)                                          |
| `…094000` | Technician profiles/skills/certifications (+restricted detail)/availability                     |
| `…095000` | `wo.work_orders` master: reception origin, Vehicle coherence lock, kind, refs/transition guards |
| `…096000` | `wo.work_order_status_history` (emit + coherence)                                               |
| `…097000` | `wo.jobs` (`requires_diagnostic`) + `wo.job_status_history`                                     |
| `…098000` | `wo.job_assignments` (temporal, reassignment reason)                                            |
| `…099000` | `tech.labor_sessions` (overlap EXCLUDE, ≤1 active, correction-linked)                           |
| `…100000` | WO service/part lines, additional-work (+restricted), customer approvals (+evidence)            |
| `…101000` | Diagnostic templates/versions/items (published-frozen guard)                                    |
| `…102000` | Diagnostic reports (+status history, item results, exact-version pin)                           |
| `…103000` | Findings, measurements, DTCs, evidence, recommendations, reviews                                |
| `…104000` | QC records + per-check results + QC status history                                              |
| `…105000` | Reopen attempts + rework links (+restricted cost) + the closure gate (B1..B6)                   |

## Non-migration changes

- `docs/database/data-dictionary.md` — appended every `wo`/`tech`/`dia`/`qms` table
  (restricted columns labelled).
- `docs/database/wo-tech-dia-qms-personal-data-classification.json` +
  `scripts/check-wo-tech-dia-qms-classification.mjs` +
  `npm run validate:wo-tech-dia-qms-classification` + a CI step after the apt/rec
  classification step.
- `supabase/seeds/06_wo_job_state_graph.sql` — platform WO/job state graph (structural
  reference), registered in `validate-seed-state.mjs` `STRUCTURAL_REFERENCE` and
  `config.toml`.
- `tests/db/p1-09-helpers.ts` — cascade cleanup + platform-fixture cleanup for all
  `wo`/`tech`/`dia`/`qms` tables.
- `tests/db/foundation.test.ts`, `tests/db/org-security.test.ts` — allow-list and
  exception registrations.
- 10 new P1-09 test files (71 tests).
- This `docs/phase-1/phase-1-9/` package.
