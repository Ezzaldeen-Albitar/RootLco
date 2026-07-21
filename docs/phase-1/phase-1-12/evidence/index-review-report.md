# P1-12 Evidence — Index Review (Wave 2)

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Review stream:** Structural / Performance ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy — a solo-developer self-review, **not** an independent third-party
audit. The user performs all merges. Every figure below traces to actual execution; no
numbers are fabricated or extrapolated. Machine-readable sources:
`evidence/structural-review.json` (duplicate / FK-coverage gates) and
`evidence/performance-baseline.json` (EXPLAIN plans).

## Purpose

Verify that the 999 live indexes contain no true duplicates (no redundant maintenance and
write cost), that foreign-key index coverage is complete, and that the intended
tenant-leading point-lookup query families actually use their indexes rather than falling
back to sequential scans.

## Evidence — duplicate and coverage gates

From `evidence/structural-review.json`:

| Gate                                | Result                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| Total indexes                       | **999**                                                            |
| True duplicate indexes              | **0** (`no_duplicate_indexes: true`; `duplicate_indexes: []`)      |
| Foreign-key index coverage complete | **true** (`fk_index_coverage_complete: true`; all 537 FKs covered) |

## Evidence — query-family EXPLAIN baseline

Plans captured by `scripts/db/perf-baseline.mjs` over a **generated, non-personal**
ephemeral dataset (**30,000 partners + 30,000 vehicles across 2 tenants**, **25 iterations**,
deleted after the run). Source: `evidence/performance-baseline.json`.

| Query family                       | Top plan node                       | Index used | Seq scan  | Median (ms) | p95 (ms) | p99 (ms) |
| ---------------------------------- | ----------------------------------- | ---------- | --------- | ----------: | -------: | -------: |
| `partner_point_lookup_tenant_id`   | Index Scan (`pk_business_partners`) | **true**   | **false** |       1.065 |    1.499 |    1.748 |
| `vehicle_point_lookup_tenant_id`   | Index Scan (`pk_vehicles`)          | **true**   | **false** |       1.023 |    1.126 |    1.260 |
| `partner_scan_by_tenant_isolation` | Aggregate → Seq Scan                | false      | true      |       3.727 |    4.408 |    4.942 |
| `partner_outstanding_balance_fn`   | Result                              | false      | false     |       1.588 |    1.849 |    1.954 |

**Interpretation.** The two tenant-leading **point lookups** confirm the intended plan:
`index_used = true`, `uses_seq_scan = false`, served by an Index Scan on the primary key at
~1 ms median. The tenant-scoped isolation **count** is an expected **bounded** sequential
scan whose selectivity is the tenant isolation predicate (≈3.7 ms median), not a full-table
regression. The `partner_outstanding_balance` function resolves via a `Result` node
(≈1.6 ms). No point-lookup family regressed to a sequential scan.

## Baseline scope disclaimer

These are **proposed validation baselines**, not production-capacity claims. Open decisions
**P1-OD-027 / NFR-SCL** (scalability) remain unresolved. The dataset is generated, contains
no personal data, and was deleted after measurement (nothing committed).

## Status

**PASS.** 0 true duplicate indexes across 999 indexes; foreign-key index coverage complete;
the tenant-leading point-lookup families use their indexes (`index_used = true`,
`uses_seq_scan = false`) at ~1 ms median per EXPLAIN evidence. Zero unresolved Critical or
High findings for this review.
