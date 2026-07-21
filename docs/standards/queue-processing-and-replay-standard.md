# Queue Processing and Replay Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every asynchronous work path from Phase 1-13 onward.
All numeric limits are **proposed validation baselines pending measurement**; P1-OD-027 (NFR-SCL) is unresolved ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-015, P1-13-BE-016, P1-13-BE-017, P1-13-DO-002 ·
**Related:** [Event Catalog v0.1](./event-catalog-v0.1.md) ·
[Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[Scalability and Backpressure Standard](./scalability-and-backpressure-standard.md) ·
[Observability Standard](./observability-standard.md) ·
[ADR-014 Distributed Consistency Model](../adr/ADR-014-distributed-consistency-model.md) ·
[Transaction and Concurrency Standard](../database/transaction-and-concurrency-standard.md) ·
Implementation: [`src/server/events/publisher.ts`](../../src/server/events/publisher.ts),
[`src/server/worker/outbox-worker.ts`](../../src/server/worker/outbox-worker.ts),
[`src/server/worker/consumer-registry.ts`](../../src/server/worker/consumer-registry.ts),
[`src/server/worker/backoff.ts`](../../src/server/worker/backoff.ts)

---

## 1. The queue is the database

**`shared.event_outbox` is the queue, and PostgreSQL is the source of truth in this phase.** There is
no broker, no external queue service, and no second delivery path.

Reasons, in order of weight:

1. **The producer side must be atomic with the business change.** An event must exist if and only if
   the transaction that produced it committed (BR-INT-001). A broker cannot participate in that
   transaction, so publishing to one requires either a dual write — the failure window the outbox
   pattern exists to eliminate — or an outbox anyway.
2. **A broker adds an unproven delivery path alongside a proven one.** The claim protocol,
   at-least-once semantics, retry, lease recovery, and dead-lettering are all already implemented in
   the frozen schema and exercised against it.
3. **Operational capacity.** A broker is another service to provision, secure, upgrade, back up, and
   monitor, in a project where only the Local environment exists (ADR-012).
4. **It would not remove any current constraint.** Nothing in the present workload is limited by the
   database's ability to hold a queue.

If a broker is ever justified, the justification must be a **measured** driver, and the outbox stays:
the producer keeps writing to `shared.event_outbox` inside its transaction, and a relay publishes
from there. The outbox is the pattern, not the transport.

> **Status today.** Phase 1-13 publishes **no domain events** — the
> [Event Catalog](./event-catalog-v0.1.md) reserves names only, and every entry carries
> `implementedIn: null`. The producer grant is in place: `app_runtime` holds tenant-scoped SELECT
> and INSERT on `shared.event_outbox`
> ([DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)),
> while claiming, completing, and failing an envelope stay `app_worker`'s alone. The mechanism
> below is implemented; the traffic is not yet there.

## 2. Producer side — write the event in the business transaction

`publishEvent(db, …)` writes one row into `shared.event_outbox` using **the caller's transaction
handle**. That is the whole pattern:

```text
BEGIN
  set_config('app.tenant_id',  …, true)   -- transaction-local
  …business state change…
  …status history…
  …audit append…
  INSERT INTO shared.event_outbox …       -- the event
COMMIT                                     -- all four, or none
```

There is no "publish after commit" path, because that is precisely the window in which a crash loses
the event. There is also no "publish before the work", because that would emit an event for a change
that may roll back.

`event_key` is unique per tenant, so a producer that retries its own command cannot emit the same
event twice — publication is idempotent at the **database** level rather than by convention. A
duplicate surfaces as `ERR-INT-001` rather than being swallowed: the unique violation aborts the
transaction, and the caller decides.

## 3. Claim protocol

```sql
SELECT * FROM shared.claim_outbox_events($claimant, $limit, $lease::interval)
```

The function uses `FOR UPDATE SKIP LOCKED` and stamps a lease. Four consequences:

| Property                     | Comes from                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **No double ownership**      | `FOR UPDATE SKIP LOCKED` — two workers can never claim the same row, regardless of how many processes exist |
| **No loss on crash**         | The lease expires and the row becomes claimable again, instead of being stranded in `claimed` forever       |
| **No head-of-line blocking** | `SKIP LOCKED` steps over rows another worker holds rather than waiting behind them                          |
| **Bounded intake**           | `$limit` is `OUTBOX_BATCH_SIZE`                                                                             |

**No in-process lock is used, and none would be sufficient**: a process-local mutex says nothing about
the other instance. Exclusivity is a property of the database, which is the only component both
workers agree on.

`attempt_count` is incremented by the database on claim, so the retry schedule is driven by durable
state rather than by in-process memory a restart would lose.

## 4. At-least-once delivery with idempotent consumers

Delivery is **at-least-once**. That is not a limitation to apologise for — it is the only honest
guarantee a durable queue can give across a crash. The consequence is a requirement: **every consumer
must be idempotent**, and the foundation makes that structural rather than aspirational.

`shared.processed_events` has `PRIMARY KEY (consumer_code, event_id)`. `runConsumer()` runs the
consumer's side effects **and inserts that marker in the same transaction**:

```text
BEGIN
  consumer.handle(event, db)                 -- side effects
  INSERT INTO shared.processed_events        -- (consumer_code, event_id, tenant_id, outcome, …)
COMMIT
```

On a redelivery the insert hits the primary key, the transaction aborts, and **the whole attempt —
marker and side effects together — is discarded**. The event is reported as `already-processed`
rather than applied twice. The earlier successful attempt's effects remain.

**Exactly-once effect, at-least-once delivery.** Inserting the marker after the side effects rather
than before is equivalent (both commit or neither does) and keeps the `outcome` column truthful: it
records what actually happened, not what was about to be attempted.

Consumers register through `registerConsumer()`, which enforces the `consumer_code` format contract
(`^[a-z][a-z0-9_.]{1,62}$`), rejects a duplicate code, and rejects a consumer that handles no event
types. Consumers for one event type run in deterministic (code-sorted) order.

## 5. Bounded batch and concurrency

| Bound                    | Setting                   | Default | Effect                                                                       |
| ------------------------ | ------------------------- | ------- | ---------------------------------------------------------------------------- |
| Rows claimed per batch   | `OUTBOX_BATCH_SIZE`       | 25      | Bounds intake and lease exposure                                             |
| Events processed at once | `OUTBOX_MAX_CONCURRENCY`  | 4       | Bounds in-flight transactions and consumer invocations                       |
| Idle poll interval       | `OUTBOX_POLL_INTERVAL_MS` | 2000    | Applied only when a batch claimed nothing, and after a batch-level fault     |
| Worker pool size         | derived                   | —       | `max(2, OUTBOX_MAX_CONCURRENCY + 1)` — sized by the worker's own concurrency |

`withConcurrency()` is a fixed-size semaphore: never more than `limit` in flight, each worker pulling
the next index until the batch is exhausted. In-flight work is bounded by the **limit**, not by the
batch size.

A batch-level failure (a broken database, for example) sleeps for the poll interval before retrying,
so a persistent fault produces a slow loop rather than a spin.

## 6. Retry with backoff and jitter

On a consumer failure the worker calls:

```sql
SELECT shared.fail_outbox_event($id, $claimant, $reason, $delay::interval, $maxAttempts)
```

The delay is `backoffInterval(attempt_count, …)` — bounded exponential backoff with **full jitter**,
uniform in `[0, min(OUTBOX_MAX_BACKOFF_MS, OUTBOX_BASE_BACKOFF_MS × 2^(attempt-1))]`. Full jitter is
chosen because the queue is durable: a retry that lands early is harmless, so maximising the spread of
retry instants matters more than guaranteeing a minimum wait. See
[Scalability and Backpressure §7](./scalability-and-backpressure-standard.md#7-retry-with-bounded-exponential-backoff-and-full-jitter).

The failure reason is truncated to 1000 characters before it is stored.

**If recording the failure itself fails**, the worker captures the exception and returns without
completing the row. The claim is still held, so the lease returns the event to the queue: losing the
failure bookkeeping must never lose the event.

## 7. Attempt ceiling, dead-letter, and the alert hook

When `attempt_count` reaches `OUTBOX_MAX_ATTEMPTS` (default 8), `shared.fail_outbox_event` moves the
row to `dead_letter`, and the worker additionally:

1. **inserts a row into `shared.error_records`** with `error_code = 'outbox.dead_letter'`,
   `source = 'outbox_worker'`, `operation = 'publish:<event_type>'`, `severity = 'critical'`,
   `retryable = false`, the correlation ID, and a bounded structured context —
   `{ eventId, eventType, attemptCount, reason }`. **The payload is deliberately not copied**: an
   error record is an operational signal, not a duplicate of the business document;
2. **increments `outbox.dead_letter.count`** labelled by event type;
3. **emits the alert hook**: `log.error('Outbox event moved to dead letter', …)` with the stable code
   `outbox.dead_letter`.

**The alert hook is an error-level log record with a stable code — nothing more.** State it plainly:
**no pager integration, no on-call rotation, and no notification channel is provisioned or claimed**
(ADR-012). A log pipeline that alerts on `errorCode = "outbox.dead_letter"` is the intended
integration point, and it does not exist yet. What exists is a signal that is stable enough to alert
on when a pipeline is provisioned.

## 8. Poison messages

A poison message is one that cannot succeed no matter how many times it is retried. The foundation
detects one specific, structural case: **an unsupported schema version.**

`runConsumer()` returns `unsupported-version` when the event's `schema_version` is not in the
consumer's declared `supportedSchemaVersions`. The worker treats that as an immediate failure and
routes the event toward dead-letter rather than retrying, because retrying cannot help.

The alternative — ignoring an unrecognised payload shape — is rejected: silently skipping a version
you do not understand is how a consumer misses half a migration and nobody notices for a month. A
dead-lettered event is visible, counted, and replayable once the consumer declares the version.

Other poison classes (a payload that violates a consumer's own invariants) reach the attempt ceiling
and dead-letter on the ordinary path.

## 9. Replay

Replay means re-processing an event whose delivery previously failed or dead-lettered. It is safe
**because** consumer idempotency is enforced by `shared.processed_events`, and the replay procedure
must preserve that property rather than work around it.

**Procedure.**

1. **Diagnose first.** Read the `shared.error_records` rows for the affected `eventId`s. Replay is for
   events that failed for a reason that has since been fixed — a deployed consumer fix, a restored
   dependency, a newly declared schema version. Replaying an unchanged system reproduces the failure
   and consumes the attempt budget again.
2. **Fix the cause and deploy it.** For an unsupported version, that means adding the version to the
   consumer's `supportedSchemaVersions`. For a consumer defect, that means deploying the fix.
3. **Reset the queue state** for the selected rows: `status` back to `pending`, claim and lease
   cleared, and `attempt_count` reset so the backoff schedule starts fresh. Select rows explicitly by
   `id`; never by a broad predicate such as "all dead letters".
4. **Do not delete `shared.processed_events` markers.** This is the rule that makes replay safe. A
   consumer that already applied the event has its marker; on replay its transaction aborts on the
   primary key and reports `already-processed`, so the effect is not duplicated. **Deleting markers
   converts a safe replay into a duplicate-effect incident** — it is the single most dangerous action
   available during a replay, and it is never part of the procedure.
5. **Replay a bounded set.** The worker's batch and concurrency bounds apply, so a large replay
   drains at a controlled rate rather than as a burst.
6. **Watch the metrics** in §10 while it drains, and record what was replayed, by whom, and why.

**Partial-consumer replay.** When one consumer of several failed, the event is replayed for all
subscribed consumers; the ones that already succeeded are protected by their markers and take the
`already-processed` path. There is no need — and no supported mechanism — to replay for a single
consumer by deleting its marker.

## 10. Queue observability

`queueHealth()` reports, and publishes as gauges:

| Signal                         | Metric                               | Meaning                                                            |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------ |
| Depth (`pending` + `claimed`)  | `outbox.queue.depth`                 | Work outstanding                                                   |
| Oldest pending age, in seconds | `outbox.queue.oldest_age_seconds`    | **The latency signal.** Depth alone hides a single stuck old event |
| Dead-letter count              | `outbox.dead_letter.count` (counter) | Events that exhausted their attempts                               |
| Retries                        | `outbox.retry.count`                 | Labelled by event type                                             |
| Processing duration            | `worker.processing.duration_ms`      | Labelled by event type                                             |

Worker readiness (`workerReadiness()`) reports queue reachability, whether the claim loop is running,
depth and oldest age, and the dead-letter count. **Depth alone never makes the worker unready** — a
deep queue means "work to do", not "broken". A non-zero dead-letter count is `degraded`; a stopped
loop is `unavailable`.

## 11. Graceful shutdown and recovery

`stop()` stops **claiming** first, then drains what is already claimed within
`OUTBOX_SHUTDOWN_GRACE_MS`. Anything still in flight when the grace expires is **left claimed**: the
lease returns it to the queue, which is safer than forcing a completion the consumers may not have
finished.

That makes "the process crashed mid-batch" and "the process was stopped mid-batch" the same,
already-handled case — lease expiry, then re-claim, then the consumer's idempotency marker decides
whether the work is redone or skipped.

## 12. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed. All batch sizes, concurrency limits, lease durations, backoff bounds,
and attempt ceilings are proposed validation baselines pending measurement.
