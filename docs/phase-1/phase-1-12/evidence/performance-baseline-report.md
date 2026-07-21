# P1-12 Evidence — Performance Baseline Report

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Wave:** 6.3 (performance
baseline) · **Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45) · **Branch:**
`feature/p1-12-database-integration-validation-release-gate`.

> **Governance / self-review note.** Produced and reviewed under the Solo Developer Review Policy
> and the Standing Technical Authorization Policy — owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party
> audit. All merges are performed by the owner. Every figure below is copied verbatim from actual
> execution (`evidence/performance-baseline.json`); nothing is extrapolated.

## Explicit baseline disclaimer (read first)

> These are **PROPOSED VALIDATION BASELINES** measured on a generated, non-personal dataset —
> **NOT** production-capacity claims. The scalability / non-functional scaling requirement is
> **UNRESOLVED: P1-OD-027 / NFR-SCL**. No production RPO/RTO, throughput, or concurrency SLO is
> asserted here. The numbers characterize query-plan health at the measured scale so regressions
> are detectable; they do not certify production performance.

## Method

- **Script:** `scripts/db/perf-baseline.mjs`
- **Dataset:** 30,000 partners + 30,000 vehicles across 2 tenants (ephemeral, non-personal,
  deleted after) — see `performance-dataset-manifest.md`.
- **Timing:** **25 iterations** per family; median / p95 / p99 in milliseconds.
- **Plan capture:** `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`; the plan tree is walked to record
  the top node, whether an index scan is used, and whether any sequential scan appears.
- **Environment:** PostgreSQL 17 (Supabase local), Node.js v24.16.0, Windows 11 (MINGW64),
  12 logical CPUs / 34.0 GB RAM.

## Results — the four query families

| #   | Query family                       | Median (ms) | p95 (ms) | p99 (ms) | Top node   | Index used | Seq scan | Plan nodes                         |
| --- | ---------------------------------- | ----------: | -------: | -------: | ---------- | ---------- | -------- | ---------------------------------- |
| 1   | `partner_point_lookup_tenant_id`   |       1.065 |    1.499 |    1.748 | Index Scan | **true**   | false    | `Index Scan(pk_business_partners)` |
| 2   | `vehicle_point_lookup_tenant_id`   |       1.023 |    1.126 |    1.260 | Index Scan | **true**   | false    | `Index Scan(pk_vehicles)`          |
| 3   | `partner_scan_by_tenant_isolation` |       3.727 |    4.408 |    4.942 | Aggregate  | false      | **true** | `Aggregate`, `Seq Scan`            |
| 4   | `partner_outstanding_balance_fn`   |       1.588 |    1.849 |    1.954 | Result     | false      | false    | `Result`                           |

## Interpretation (recorded, non-blocking)

- **Families 1 & 2 — tenant-leading point lookups:** index-backed (`index_used = true`,
  `uses_seq_scan = false`), sub-2 ms across median/p95/p99. Plans confirm primary-key index scans
  (`pk_business_partners`, `pk_vehicles`) — the intended access path.
- **Family 3 — tenant-scoped aggregate count:** a bounded sequential scan under `Aggregate`. This
  is expected: the query aggregates the tenant-scoped set (isolation selectivity), so a scan of
  the qualifying rows is the correct plan at this volume, completing at ~3.7 ms median. Recorded,
  not flagged as a regression.
- **Family 4 — `partner_outstanding_balance` function:** resolves via a `Result` node at ~1.6 ms
  median; no sequential scan.

No query family exhibited an unexpected or unbounded scan. All misses against an index are
**classified** (Family 3 is an intended aggregate scan; Family 4 is a scalar function result) —
none were silently passed.

## Status

**Status: PASS — PROPOSED BASELINE RECORDED.** All four families measured with medians and
percentiles captured, plans inspected, and index usage recorded from actual execution. This is a
regression-detection baseline only; the production-capacity question remains open under
**P1-OD-027 / NFR-SCL**. Machine-readable source of truth: `evidence/performance-baseline.json`.
