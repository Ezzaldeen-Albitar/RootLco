# P1-24 — read-path performance baseline

**This is a baseline, not a pass.** No number below is compared against a threshold,
because no approved numeric threshold exists to compare it against.

## What the approved requirement actually says

The canonical requirement is **`NFR-PERF-01`**, not `NFR-PERF-001`. The P1-12
traceability record
([`docs/phase-1/phase-1-12/phase-1-12-traceability.md`](../../phase-1-12/phase-1-12-traceability.md))
states its status in its own words:

> Tenant-leading indexed POINT lookups use index (no seq scan), ~1 ms median
> (**validation baseline**)

and records the numbers it produced as "PROPOSED validation baselines only". The
adjacent open decision is explicit:

> **P1-OD-027** — Scalability / production capacity (`NFR-SCL`) — **UNRESOLVED**

So there is an approved _structural_ property (indexed, tenant-leading, no sequential
scan) and an approved _measurement practice_. There is no approved latency budget, no
approved throughput figure, and no approved dataset size. P1-24 therefore records what
it measured and does not label it a pass — §20 of the phase brief requires exactly
this, and inventing a budget here would produce a green tick against a number this
phase made up.

## Environment

|                   |                                                                        |
| ----------------- | ---------------------------------------------------------------------- |
| OS                | Windows 11 Pro, 10.0.26200 (win32)                                     |
| CPU               | 12 × Intel Core i7-8750H @ 2.20 GHz                                    |
| Memory            | 34 GB                                                                  |
| Node              | v24.16.0                                                               |
| npm               | 11.13.0                                                                |
| PostgreSQL        | 17.6 (x86_64-pc-linux-gnu, gcc 15.2.0) in the local Supabase container |
| Runner            | `vitest` 3.2.7, `vitest.config.backend.ts`, `fileParallelism: false`   |
| Database identity | `app_runtime` — the deployed runtime role, under RLS                   |

**The database shares a machine with the test runner.** Every figure below therefore
includes contention that a deployed system would not have, and excludes network
latency that a deployed system would. It is a _floor for comparison across commits on
this machine_, and nothing more.

## Measured — `tests/backend/p1-24-read-path-shape.test.ts`

Warm connection, measured end to end through the exported route handler, including
authentication, authorization inside the request transaction, and JSON serialisation.

| Operation                                      | Iterations | p50 (ms) | p95 (ms) | p99 (ms) |
| ---------------------------------------------- | ---------- | -------- | -------- | -------- |
| `iam.user-list` (limit 50)                     | 25         | 28.084   | 36.922   | 37.156   |
| `iam.role-list` (limit 50)                     | 25         | 25.016   | 29.439   | 39.376   |
| `iam.audit-event-list` (limit 50, 48 h window) | 8          | 28.314   | 35.416   | 35.416   |

`iam.audit-event-list` is sampled 8 times rather than 25 because it declares the
`expensive-read` rate-limit policy — 30 requests per minute per user per tenant. A
25-iteration sample would trip the control and measure the throttle instead of the
query.

Run-to-run variation on this machine is roughly ±30% at p50; the figures above are one
run, not an average. They are recorded so a later phase can notice a change of
_order_, not to be defended to the millisecond.

## What IS asserted, and why it is the useful part

Wall-clock on a laptop is noise. What degrades a read under real load is its shape,
and shape is deterministic:

1. **No N+1.** The runtime pool is instrumented at the `connect` boundary and every
   statement a request issues is counted. Each list route is measured against 1 row
   and against 12; the statement count must be identical. An N+1 would add eleven
   statements — larger than any connection noise can hide. The assertion is guarded by
   a second one that the larger read genuinely returned eleven more items, so it
   cannot pass against a query that silently returned nothing.

   A trap paid for here: the FIRST call in a process issues session-setup statements a
   reused client does not. The audit-list case measured 25 statements cold and 20 warm,
   which reads exactly like a query that got cheaper as its dataset grew. Every
   measurement is now preceded by a discarded warm-up call.

2. **No unbounded page.** `MAX_PAGE_SIZE` is asserted to be a real bound, and a request
   above it is REFUSED with a catalog code rather than silently clamped. A clamp is
   defensible in principle, but a caller who asks for 1000 and receives 100 has no way
   to know the page was truncated — which is how a client comes to believe it has read
   everything.

3. **No unbounded window.** `iam.audit-event-list` additionally refuses an arbitrarily
   wide date range: page size is not the only unbounded dimension, and a wide window
   with cursor paging is a full export with extra steps.

4. **The throttle is a control, not a declaration.** `expensive-read` is proved to fire
   with `ERR-RTE-001` once its window is spent. This one was discovered rather than
   planned — an earlier draft of the baseline measured 25 iterations of the audit read
   and the _next test in the file_ answered 429. That looked like a defect and was the
   control working, so the accident became the assertion.

## Not measured, and honestly so

- **Deployed latency.** No deployment exists; nothing here is a production figure.
- **Throughput and concurrency limits.** `NFR-SCL` is unresolved (`P1-OD-027`), and a
  number produced here would pre-empt an owner decision.
- **Connection-pool exhaustion under load.** The harness runs a 4-connection pool with
  `fileParallelism: false`; the shipped configuration is different and untested at
  scale.
- **Export amplification.** No export execution surface exists to measure — export is
  an authorization, not a materialisation, in the current backend.
- **The database-layer baseline.** That is `scripts/db/perf-baseline.mjs`, owned by
  P1-12 and unchanged by this phase.
