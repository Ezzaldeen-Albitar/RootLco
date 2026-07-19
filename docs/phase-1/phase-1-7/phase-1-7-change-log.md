# Phase 1-7 Change Log

Commit-level history of the feature branch `feature/p1-07-vehicle-database`
(base `develop` @ `416cf9e`). Every commit was pushed only after its targeted
tests, the repo-wide guards, and typecheck/lint/format all passed with
unmasked exit codes. Later commits (red-team fixes, evidence register,
completion report) are appended as they land.

| Commit    | Scope                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ab7113f` | VIN/plate normalization functions + 5 dual-scope reference catalogs (DB-002/006/010 foundation)                                                                                    |
| `d60e0d1` | Independent Vehicle master: generated VIN, active-VIN/display uniqueness, catalog-ref + merge guards (DB-001/002/019 foundation)                                                   |
| `ceefd84` | Identifier ledger + missing-VIN activation contract (DB-003, CR-VEH-03)                                                                                                            |
| `e9f83e9` | Append-only VIN verifications + attribute history (DB-004/005)                                                                                                                     |
| `8c36010` | Mechanical + EV domain: engine/transmission temporal, EV profiles, battery masters/readings (DB-007/008/009)                                                                       |
| `93bcb78` | Plate/ownership/relationships/evidence + crown-jewel privacy proof (DB-010..013, FR-VEH-004)                                                                                       |
| `a12802e` | Odometer/status/alerts/duplicates/merges — schema complete at 23 tables (DB-014..018, CR-VEH-01/02)                                                                                |
| `85f9029` | Classification stack: 320-column registry, canonical validator, npm script, CI step (SEC-003/DO-001)                                                                               |
| `314ca3b` | Auto-enumerating RLS/grant/function-security inventory (DB-021)                                                                                                                    |
| `32cd096` | Search contract doc + runtime read-only projection tests (DB-019)                                                                                                                  |
| `be85c2c` | Auto-enumerating two-tenant isolation suite (QA-007)                                                                                                                               |
| `4232708` | 18-race concurrency suite + root-caused latent unhandled-rejection flake fix in 4 race tests (QA-008)                                                                              |
| `26deb96` | Index + query-plan review evidence: 54 FKs covered, 24 plans, zero Seq Scans (DB-020)                                                                                              |
| `8c73ba9` | SEC-001 visibility matrix, SEC-002 scope contract, SEC-004 53-case abuse ledger; seed-state validator sweeps crm+veh (DB-022); classification-validator negative fixtures (DO-001) |

Wave 7+ commits (documentation package, structural contract test, red-team
dispositions, clean-room evidence) follow in subsequent rows of this table as
they are pushed; the definitive list is `git log 416cf9e..HEAD` on the branch.
