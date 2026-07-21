# Scalability and Backpressure Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every backend phase from Phase 1-13 onward.
All numeric limits are **proposed validation baselines pending measurement**; P1-OD-027 (NFR-SCL) is unresolved ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-003, P1-13-BE-016, P1-13-DO-002, and the phase's cross-cutting scalability
principle; the canonical task allocation lives in the external plan documents recorded in
[canonical-documents.md](../governance/canonical-documents.md) ·
**Related:** [Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[Queue Processing and Replay Standard](./queue-processing-and-replay-standard.md) ·
[Rate-Limiting Standard](./rate-limiting-standard.md) ·
[Cache Eligibility and Invalidation](./cache-eligibility-and-invalidation.md) ·
[Observability Standard](./observability-standard.md) ·
[ADR-015 Load-Balancer Readiness](../adr/ADR-015-load-balancer-readiness.md) ·
[ADR-017 Read-Replica Readiness](../adr/ADR-017-read-replica-readiness.md) ·
[ADR-012 Local-First Environment](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)

---

## 1. What this standard claims, and what it does not

It claims that the code has specific **structural properties**: stateless handlers, no
correctness-critical state in process memory, bounded resources everywhere, explicit timeouts,
jittered retries, and a graceful shutdown that does not lose work.

It claims **nothing** about capacity. No environment beyond Local exists (ADR-012). There is no
measured throughput, no requests-per-second figure, no latency-SLO compliance statement, no failover
behaviour, and no horizontal-scaling result. **Every numeric limit in this document is a proposed
validation baseline for measurement, not an approved production target.** Open decision **P1-OD-027
(NFR-SCL)** is unresolved, and no document may cite this one as evidence that it has been resolved.

The distinction matters because these properties are what makes measurement _possible_ later. They
are not a substitute for it.

## 2. Stateless handlers

A request handler holds no state that outlives the request.

- Every value a handler needs comes from the request, the resolved `RequestContext`, or the database
  through the transaction handle.
- `RequestContext` is built per request, frozen at construction (including its arrays), and passed as
  an argument. **There is no ambient or global context**, so nothing is implicitly shared between
  requests on the same process.
- The transaction handle is passed **per call**, never held on a service instance. A service instance
  is cheap and stateless and may outlive a request; holding a handle would let one request's
  transaction leak into another's.
- Composed module services (`composeModule()`) are memoised per process, which is safe precisely
  because they hold no request state.
- Session context in PostgreSQL is set with the transaction-local form of `set_config`, so a pooled
  connection cannot carry one request's tenant into the next.

The consequence: any instance can serve any request. That is the property
[ADR-015](../adr/ADR-015-load-balancer-readiness.md) depends on, and it is why sticky sessions are
neither needed nor permitted.

## 3. No correctness-critical state in process memory

Process memory is used only where losing it costs performance, never correctness.

| In-process state                   | What it is                        | What is lost on restart                                                    |
| ---------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `InMemoryCache`                    | Cache-aside store                 | Cache warmth only; the next read repopulates through the authorized loader |
| `InMemoryMetricsRecorder`          | Counters and observations         | Local metric history; the port exists so an exporter can replace it        |
| `RecordingErrorMonitor` ring       | Last 100 sanitised events         | A test and rehearsal convenience                                           |
| `InMemoryRateLimitStore`           | Fixed-window counters             | Counters — and **this one is a correctness caveat**, see §4                |
| Registries (operations, consumers) | Declarations built at import time | Nothing; they are rebuilt deterministically at start                       |
| `foundationCapabilities` cache     | Preflight result                  | Nothing; re-probed on next use                                             |

Everything that must survive a restart is in PostgreSQL: idempotency keys, the outbox, processed-event
markers, attempt counts, leases, audit records, and error records. The worker's retry schedule is
driven by `event_outbox.attempt_count`, which the database increments on claim — durable state, not
in-process memory a restart would lose.

## 4. No in-memory lock is a distributed lock

This is stated as a rule because it is the most common way a "scalable" system turns out not to be.

- **A process-local mutex says nothing about the other instance.** The outbox worker therefore uses no
  in-process lock at all: exclusivity comes from `FOR UPDATE SKIP LOCKED` inside
  `shared.claim_outbox_events`, so two workers can never own the same row regardless of how many
  processes exist.
- **Idempotency uses no advisory lock and no polling.** The unique index on
  `(tenant_id, operation, idempotency_key)` is the arbiter: both callers insert, one wins, the loser
  catches `23505` and re-reads the winner's row.
- **Optimistic concurrency uses no lock.** The version predicate and the increment are in one
  statement, so there is no read-modify-write window.
- **The rate-limit store is honest about not being shared.** `InMemoryRateLimitStore.isShared` is
  `false`, and `assertStoreSuitableForMultiInstance()` throws when it is used in a multi-instance
  deployment. A process-local store does not rate limit; it rate limits _per instance_, which is a
  different and much weaker property. Rather than leave that in a comment, the code refuses.

## 5. Bounded everything

An unbounded pool, batch, page, or concurrency limit is how one bad request takes down an instance.
Every limit below is validated at startup by `src/server/config/backend-config.ts` with a default and
an explicit range.

| Setting                     | Default | Range           | Bounds what                                       |
| --------------------------- | ------- | --------------- | ------------------------------------------------- |
| `DB_POOL_MAX`               | 10      | 1–50            | Connections held by one web instance              |
| `DB_POOL_IDLE_TIMEOUT_MS`   | 30 000  | 1 000–300 000   | How long an idle connection is retained           |
| `DB_CONNECTION_TIMEOUT_MS`  | 5 000   | 500–60 000      | Waiting for a connection from the pool            |
| `DB_STATEMENT_TIMEOUT_MS`   | 15 000  | 100–120 000     | Server-side statement execution                   |
| `OUTBOX_BATCH_SIZE`         | 25      | 1–500           | Rows claimed per batch                            |
| `OUTBOX_MAX_CONCURRENCY`    | 4       | 1–32            | Events processed simultaneously                   |
| `OUTBOX_LEASE_SECONDS`      | 300     | 5–3 600         | How long a claim is held before it is reclaimable |
| `OUTBOX_MAX_ATTEMPTS`       | 8       | 1–50            | Attempts before dead-letter                       |
| `OUTBOX_BASE_BACKOFF_MS`    | 1 000   | 10–600 000      | Backoff base                                      |
| `OUTBOX_MAX_BACKOFF_MS`     | 300 000 | 1 000–3 600 000 | Backoff ceiling                                   |
| `OUTBOX_POLL_INTERVAL_MS`   | 2 000   | 50–600 000      | Idle poll interval                                |
| `OUTBOX_SHUTDOWN_GRACE_MS`  | 15 000  | 0–120 000       | Drain window on shutdown                          |
| `CACHE_MAX_ENTRIES`         | 5 000   | 16–100 000      | Cache entries before eviction                     |
| `CACHE_DEFAULT_TTL_SECONDS` | 60      | 1–86 400        | Default TTL                                       |

Further bounds not expressed as configuration: page size (default 50, maximum 100),
`InMemoryRateLimitStore` key space (50 000, evicting the oldest-resetting bucket rather than
exhausting memory), metrics series (512) and retained observations (4096), redaction depth (8),
array truncation (100 elements), and log string length (2048 characters).

The worker's pool is sized by **its own** concurrency — `max(2, OUTBOX_MAX_CONCURRENCY + 1)` — not by
the web tier's, because the two roles have unrelated shapes.

## 6. The worker's concurrency semaphore

`processOutboxBatch()` runs claimed rows through `withConcurrency(items, limit, run)`: a fixed number
of workers, never more than `limit`, each pulling the next index until the batch is exhausted.

Two properties matter. **In-flight work is bounded by the limit, not by the batch size** — claiming 25
rows with a concurrency of 4 means at most 4 database transactions and 4 consumer invocations at once.
And **the batch is a claim bound, not a memory bound**: the batch is claimed atomically with a lease,
so the queue's own back-pressure (rows stay `pending` when the worker is busy) is what prevents
unbounded intake.

## 7. Retry with bounded exponential backoff and full jitter

`backoffDelayMs(attempt, { baseMs, maxMs })` returns a delay uniformly distributed in
`[0, min(maxMs, baseMs × 2^(attempt-1))]`.

Two failure modes this exists to prevent:

- **Retry storm.** A downstream outage makes every consumer fail at once; a fixed retry interval makes
  them all retry at once, forever, at full rate. Exponential growth with a ceiling turns that into a
  decaying trickle.
- **Thundering herd.** Pure exponential backoff keeps failures _synchronised_ — every event that
  failed together retries together, just later. Jitter breaks the synchronisation.

**Why full jitter rather than equal jitter or a ± wobble.** Full jitter samples the whole interval
`[0, ceiling]`, which maximises the spread of retry instants; equal jitter
(`ceiling/2 + rand(0, ceiling/2)`) guarantees a minimum wait but halves the spread. The trade is
"guaranteed minimum delay" against "maximum decorrelation", and here the queue is **durable**: a retry
that lands early is harmless — it either succeeds or fails again and backs off further — so
decorrelation is worth more than a minimum wait.

The exponent is capped at 30 before the power is computed, so a large attempt count cannot produce
`Infinity` on the way to being clamped. `attempt` is 1-based and comes from
`event_outbox.attempt_count`, i.e. from durable state.

## 8. Explicit timeouts

"No timeout" is a choice, and it is never the choice made here.

| Boundary                             | Control                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Acquiring a pooled connection        | `connectionTimeoutMillis` (`DB_CONNECTION_TIMEOUT_MS`)                                           |
| Statement execution, per connection  | `statement_timeout` set on the pool                                                              |
| Statement execution, per transaction | `SET LOCAL statement_timeout` — revertible, so it cannot leak to the next user of the connection |
| Long analytical work                 | Must opt in explicitly via `TransactionOptions.statementTimeoutMs`, never inherit silently       |
| Idle connection retention            | `idleTimeoutMillis`                                                                              |
| Outbox claim lease                   | `OUTBOX_LEASE_SECONDS` — a dead worker's claim expires and the row becomes claimable             |
| Shutdown drain                       | `OUTBOX_SHUTDOWN_GRACE_MS`                                                                       |

An idle-client error on either pool is handled by an `error` listener. Without one, a server restart
or network reset becomes an unhandled `'error'` event that kills the process.

## 9. Graceful shutdown

The sequence is: **stop claiming, drain what is held within a bounded window, and let the lease
recover anything still in flight.**

1. `stop()` sets the stopping flag, so `isRunning()` returns false immediately. **Readiness goes
   false before liveness** — a balancer stops sending work before the process stops accepting it.
2. No new batch is claimed.
3. The in-flight batch is awaited, raced against `OUTBOX_SHUTDOWN_GRACE_MS`.
4. Anything still in flight when the grace expires is **left claimed**. The lease returns it to the
   queue, which is safer than forcing a completion the consumers may not have finished.
5. `closePools()` / `closeWorkerPool()` end the pools.

Point 4 is the design decision worth naming: the shutdown path never marks work complete that it
cannot prove completed. Lease-based recovery makes "the process died mid-batch" and "the process was
stopped mid-batch" the same, already-handled case.

The poll timer is `unref`'d, so waiting for the next poll never holds the process open.

## 10. Readiness before liveness during drain

| Phase    | Liveness | Readiness     | Effect                                           |
| -------- | -------- | ------------- | ------------------------------------------------ |
| Starting | alive    | not ready     | Must **not** be restarted; it is starting up     |
| Serving  | alive    | ready         | Receives work                                    |
| Draining | alive    | **not ready** | Stops receiving new work; finishes what it holds |
| Stopped  | —        | —             | Removed from rotation                            |

`foundationReadiness()` and `workerReadiness()` produce the signals; they are not yet wired to HTTP
routes (Phase 1-15 owns the richer health endpoints). A missing database write capability reports
`degraded`, not `unavailable`, so a documented grant gap does not become an outage.

## 11. Web and worker roles scale independently

| Dimension       | Web role                           | Worker role                                             |
| --------------- | ---------------------------------- | ------------------------------------------------------- |
| Process         | Next.js server                     | Outbox worker loop                                      |
| Connection      | `DATABASE_URL`, `app_runtime`      | `WORKER_DATABASE_URL`, `app_worker`                     |
| Session context | Set per transaction                | None; the tenant is read from the row                   |
| Work intake     | Inbound requests                   | Claimed queue batches                                   |
| Backpressure    | Rate-limit policies + bounded pool | Batch size, concurrency semaphore, poll interval, lease |
| Readiness       | `foundationReadiness()`            | `workerReadiness()`                                     |

They are independently startable and independently drainable. Neither imports the other's pool, and
the request path must never borrow the worker connection — the worker's policies are `USING (true)`,
deliberately all-tenant, and giving that to a request handler would dissolve tenant isolation.

## 12. What is deliberately not done

| Not done                                 | Why                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No external cache service                | A new dependency, a new failure mode, and a second place tenant data lives, in exchange for nothing a single-instance deployment needs                                                                                   |
| No message broker                        | The database outbox is a proven delivery path; a broker would add an unproven one alongside it                                                                                                                           |
| No distributed rate-limit store          | A fake "distributed" store would be worse than none. The contract exists; the adapter is a deployment decision                                                                                                           |
| No replica routing                       | `poolFor('replica')` returns the primary and logs. Silently routing a strongly consistent read to a lagging replica is the most damaging thing this layer could do ([ADR-017](../adr/ADR-017-read-replica-readiness.md)) |
| No autoscaling policy, no capacity model | Both require measurement against a provisioned environment. Neither exists                                                                                                                                               |
| No load test, no benchmark figures       | A benchmark on one developer machine is not evidence about hosted behaviour, and presenting it as such would be a fabricated claim                                                                                       |

## 13. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed. Every limit in this document is a proposed validation baseline pending
measurement.
