# Phase 1-6 — Change Log

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database ·
**Branch:** `feature/p1-06-crm-business-partner-database` (base `develop` at `cd475d3`)

Chronological record of the Phase 1-6 branch commits (oldest first). Every entry
was applied to a clean database and verified before push. SHAs are the feature
branch's own commits; the final source SHA is recorded on the pull request and in
the [evidence register](./phase-1-6-evidence-register.md).

## Schema increments (Waves 2–4)

| Commit    | Summary                                                    |
| --------- | ---------------------------------------------------------- |
| `920a894` | DB-001 — CRM business-partner party master                 |
| `e39c549` | DB-004 — partner identifiers with sensitive-data gate      |
| `60c5026` | DB-004 — add tax identifier type for company tax refs      |
| `e19633d` | DB-002/003 — individual/company profiles + gated DOB       |
| `d2ca535` | DB-005 — dated partner roles with temporal exclusion       |
| `9fb9015` | DB-006 — append-only partner status history                |
| `1032f5c` | DB-007 — customer segments and dated assignments           |
| `36d04b7` | DB-008 — customer restrictions                             |
| `ea0e2c4` | DB-009/010 — contact points and addresses                  |
| `68536b9` | DB-011/012 — communication preferences and consent history |
| `1186003` | DB-013/014 — customer alerts and credit-profile foundation |
| `812762e` | DB-015 — block history with lifecycle coherence            |
| `44aae2b` | DB-016/017 — duplicate candidates and merge history        |
| `a767597` | DB-018/019 — communication log and append-only timeline    |
| `208ebfc` | DB-020 — concurrency-safe partner display numbers          |

## Search, security, isolation, concurrency (Wave 5)

| Commit    | Summary                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ebffbbd` | DB-021 — search normalization functions and projection contract                                                            |
| `ddcbc85` | fix — drop unused import (typecheck) in search-normalization test                                                          |
| `b244016` | SEC-001/DO-001 — personal-data classification registry + CI guard                                                          |
| `4d7dafe` | QA-006 — centralized two-tenant CRM isolation suite                                                                        |
| `45fda2d` | SEC-002/004 — forward hardening (INSERT-path block/merge guards, whole-document jsonb scan) + deterministic `seq` ordering |
| `c9b537c` | QA-007 — concurrent single-winner semantics suite                                                                          |
| `fa963ca` | QA-007 — accept deadlock/lock-timeout as a valid loser in the role-overlap race (5-run stability)                          |

## Documentation, structural contract (Wave 6)

| Change                            | Summary                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crm-structural-contract.test.ts` | P1-07 hand-off contract test (8 assertions)                                                                                                                                                                                    |
| Documentation package             | This folder + [migration classification](../../database/phase-1-6-migration-classification.md) + [ERD](../../database/erd/phase-1-6-crm.mmd) — matrices generated from live introspection; prose reviewed for factual accuracy |

## Notable corrections during the phase

- **Latent determinism fix.** `occurred_at`/`created_at` are stamped with `now()`,
  which is constant within a transaction; "latest row" resolution that tie-broke
  on a random uuid was non-deterministic for same-transaction events. Fixed by
  adding a monotonic `seq` IDENTITY to `customer_block_history` and
  `consent_history` (`45fda2d`).
- **Concurrency loser SQLSTATE.** A GiST EXCLUDE race can surface as `23P01`,
  `40P01`, or `55P03`; the role-overlap test now accepts all three while keeping
  the strict single-winner assertion (`fa963ca`).
- **Three Medium security findings fixed forward**, one accepted with rationale
  (`45fda2d`) — see the [evidence register §3](./phase-1-6-evidence-register.md).

The pull-request, CI, and merge events are appended once they occur; the Phase
1-6 **Go** record is committed separately into protected history after the owner
merges — see the [owner gate](./phase-1-6-owner-gate.md).
