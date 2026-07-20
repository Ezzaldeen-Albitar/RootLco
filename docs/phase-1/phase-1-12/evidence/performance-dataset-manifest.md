# P1-12 Evidence — Performance Dataset Manifest

**Phase:** 1-12 · **Release:** Release 2 — Core Business Database · **Wave:** 6.2 / 6.3
(seed campaign + generated performance dataset) · **Base:** protected `origin/develop` =
`5cd16da` (P1-11 gate merge #45) · **Branch:**
`feature/p1-12-database-integration-validation-release-gate`.

> **Governance / self-review note.** This evidence was produced and reviewed under the Solo
> Developer Review Policy and the Standing Technical Authorization Policy — an owner-authorized
> technical, QA, security, and adversarial **self-review** by Eng. Ezzaldeen Al-Bitar. It is
> **not** an independent third-party audit; all merges are performed by the owner. Every figure
> below traces to actual execution in the P1-12 validation environment; no value is extrapolated
> or fabricated.

## Purpose

Document the exact volumes, composition, provenance, and disposal of the ephemeral dataset
generated to measure the Release 2 performance baseline. The dataset exists only to exercise
tenant-leading query plans under scaled row counts; it is **not** a production-capacity claim,
and it does **not** ship with the product.

## Generator

- **Script:** `scripts/db/perf-baseline.mjs`
- **Environment:** PostgreSQL 17 (Supabase local, `supabase_db_RootLco` @ `127.0.0.1:54322`),
  Node.js v24.16.0, Windows 11 (MINGW64), 12 logical CPUs / 34.0 GB RAM.
- **Procedure:** generate the scaled non-personal rows across two tenants → `ANALYZE` →
  measure the query families (see `performance-baseline-report.md`) → **delete the generated
  rows**. No generated data is committed.

## Actual generated volumes

| Entity                     | Rows generated | Notes                                        |
| -------------------------- | -------------: | -------------------------------------------- |
| Business partners (`crm`)  |     **30,000** | Split across the two validation tenants      |
| Vehicles (`veh`)           |     **30,000** | Split across the two validation tenants      |
| Validation tenants (`org`) |          **2** | `perf_tenant_a`, `perf_tenant_b` (ephemeral) |

These are the **actual measured volumes** used for the baseline run — not a modeled or target
production scale.

## Data-handling posture

- **Non-personal by construction.** Rows are synthetic, generated identifiers and structural
  values only. No real, customer, or personally identifying data is present at any point.
- **Ephemeral.** The generated partner and vehicle rows are removed at the end of the run; the
  two validation tenants are scoped to the drill.
- **Not committed.** No generated dataset, dump, or fixture is added to the repository. Business
  tables return to empty after the drill, consistent with the standing no-fake-data policy.
- **Isolation-honest.** The dataset spans two tenants specifically so tenant-scoped selectivity
  and cross-tenant isolation are exercised, not bypassed.

## Explicit scope disclaimer

> These volumes are a **PROPOSED validation baseline** measured on a generated, non-personal
> dataset. They are **NOT** a production-capacity claim. The scalability / non-functional
> scaling requirement remains an open decision — **P1-OD-027 / NFR-SCL unresolved**. No RPO/RTO,
> throughput, or concurrency SLO is asserted from this dataset.

## Status

**Status: PASS (recorded).** Dataset generated at the stated volumes, used for the baseline
measurement, and disposed of. Non-personal and non-committed constraints satisfied; business
tables empty after the drill. Machine-readable results captured in
`evidence/performance-baseline.json`.
