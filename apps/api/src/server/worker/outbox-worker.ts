/**
 * Outbox processor worker (P1-13-BE-016, P1-13-DO-002).
 *
 * The queue is `shared.event_outbox` and the claim protocol is the database's:
 * `shared.claim_outbox_events(claimant, limit, lease)` uses
 * `FOR UPDATE SKIP LOCKED`, so two workers can never own the same row, and a
 * worker that dies mid-flight releases its claim when the lease expires — the
 * row becomes claimable again instead of being stranded. No in-process lock is
 * used or would be sufficient: a process-local mutex says nothing about the
 * other instance.
 *
 * Guarantees, and where each one comes from:
 *
 *  - *no double ownership*  → `FOR UPDATE SKIP LOCKED` in the claim function
 *  - *no loss on crash*     → lease expiry re-queues the claim
 *  - *at-least-once*        → complete only after consumers ran
 *  - *effect exactly once*  → `shared.processed_events` PK per consumer
 *  - *bounded work*         → batch size and a concurrency semaphore
 *  - *no retry storm*       → full-jitter exponential backoff
 *  - *poison messages stop* → attempt ceiling → `dead_letter` + `error_records`
 *
 * Graceful shutdown stops *claiming* first and then drains what is already
 * claimed, within a bounded grace period. Anything still in flight when the
 * grace expires is simply left claimed: the lease returns it to the queue, which
 * is safer than forcing a completion the consumers may not have finished.
 */
import { backendConfig } from '../config/backend-config';
import { log } from '../observability/logger';
import { metrics, METRICS } from '../observability/metrics';
import { captureException } from '../observability/monitoring';
import { backoffInterval } from './backoff';
import { consumersFor, runConsumer, type ConsumedEvent } from './consumer-registry';
import { SYSTEM_ACTOR_ID, withWorkerTransaction, workerQuery, type WorkerDb } from './worker-db';

interface OutboxRow {
  id: string;
  tenant_id: string;
  company_id: string | null;
  branch_id: string | null;
  event_type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  correlation_id: string | null;
  causation_id: string | null;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  attempt_count: number;
}

function toEvent(row: OutboxRow): ConsumedEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    // bigint arrives as a string from node-postgres; converting here keeps the
    // consumer contract numeric without a precision surprise at the boundary.
    aggregateVersion: Number(row.aggregate_version),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
    headers: row.headers,
    attemptCount: row.attempt_count,
  };
}

export interface QueueHealth {
  readonly depth: number;
  readonly oldestAgeSeconds: number;
  readonly deadLetterCount: number;
}

/** Queue depth, oldest pending age, and dead-letter count. */
export async function queueHealth(db: WorkerDb): Promise<QueueHealth> {
  const result = await db.query<{
    depth: string;
    oldest_age_seconds: string | null;
    dead_letters: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('pending', 'claimed'))                  AS depth,
       EXTRACT(EPOCH FROM (now() - min(occurred_at) FILTER (WHERE status = 'pending')))
                                                                                AS oldest_age_seconds,
       count(*) FILTER (WHERE status = 'dead_letter')                            AS dead_letters
     FROM shared.event_outbox`
  );
  const row = result.rows[0];
  const health: QueueHealth = {
    depth: Number(row?.depth ?? 0),
    oldestAgeSeconds: Math.max(0, Math.round(Number(row?.oldest_age_seconds ?? 0))),
    deadLetterCount: Number(row?.dead_letters ?? 0),
  };
  metrics().gauge(METRICS.outboxQueueDepth, health.depth);
  metrics().gauge(METRICS.outboxOldestAgeSeconds, health.oldestAgeSeconds);
  return health;
}

/** Records a dead-letter transition in `shared.error_records` and alerts. */
async function recordDeadLetter(row: OutboxRow, reason: string): Promise<void> {
  await withWorkerTransaction(async (db) => {
    await db.query(
      `INSERT INTO shared.error_records
         (tenant_id, company_id, branch_id, error_code, source, operation, severity,
          retryable, correlation_id, context, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        row.tenant_id,
        row.company_id,
        row.branch_id,
        'outbox.dead_letter',
        'outbox_worker',
        `publish:${row.event_type}`,
        'critical',
        false,
        row.correlation_id,
        // Structured, bounded, and free of payload contents: an error record is
        // an operational signal, not a copy of the business document.
        JSON.stringify({
          eventId: row.id,
          eventType: row.event_type,
          attemptCount: row.attempt_count,
          reason,
        }),
        SYSTEM_ACTOR_ID,
      ]
    );
  });

  metrics().increment(METRICS.outboxDeadLetterCount, { eventType: row.event_type });
  // The alert hook: an error-level record with a stable code, which the log
  // pipeline alerts on. No pager integration is provisioned or claimed.
  log.error('Outbox event moved to dead letter', {
    module: 'outbox-worker',
    operation: 'outbox.dead-letter',
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    tenantRef: row.tenant_id,
    result: 'failure',
    errorCode: 'outbox.dead_letter',
    context: { eventId: row.id, eventType: row.event_type, attempts: row.attempt_count, reason },
  });
}

export interface ProcessResult {
  readonly claimed: number;
  readonly published: number;
  readonly retried: number;
  readonly deadLettered: number;
}

/** Runs a bounded semaphore over `items`, never exceeding `limit` in flight. */
async function withConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      await run(item);
    }
  });
  await Promise.all(workers);
}

export interface WorkerOptions {
  readonly claimant?: string;
  readonly batchSize?: number;
  readonly concurrency?: number;
  readonly maxAttempts?: number;
  readonly leaseSeconds?: number;
  /** Injectable for deterministic backoff in tests. */
  readonly random?: () => number;
}

/**
 * Claims and processes one batch. Returns counts rather than logging only, so
 * the caller (loop, test, or health probe) can act on them.
 */
export async function processOutboxBatch(options: WorkerOptions = {}): Promise<ProcessResult> {
  const config = backendConfig();
  const claimant = options.claimant ?? config.WORKER_ID;
  const batchSize = options.batchSize ?? config.OUTBOX_BATCH_SIZE;
  const concurrency = options.concurrency ?? config.OUTBOX_MAX_CONCURRENCY;
  const maxAttempts = options.maxAttempts ?? config.OUTBOX_MAX_ATTEMPTS;
  const leaseSeconds = options.leaseSeconds ?? config.OUTBOX_LEASE_SECONDS;

  const claimed = await workerQuery<OutboxRow>(
    'SELECT * FROM shared.claim_outbox_events($1, $2, $3::interval)',
    [claimant, batchSize, `${leaseSeconds} seconds`]
  );

  const rows = claimed.rows;
  let published = 0;
  let retried = 0;
  let deadLettered = 0;

  await withConcurrency(rows, concurrency, async (row) => {
    const startedAt = performance.now();
    const event = toEvent(row);
    const subscribers = consumersFor(event.eventType);

    try {
      for (const consumer of subscribers) {
        const outcome = await runConsumer(consumer, event);
        if (outcome.status === 'unsupported-version') {
          // Poison message: a payload shape no registered consumer understands.
          // Retrying cannot help, so fail it straight toward dead letter.
          throw new Error(
            `Consumer ${consumer.code} does not support schema version ${event.schemaVersion}`
          );
        }
      }

      await workerQuery('SELECT shared.complete_outbox_event($1, $2)', [row.id, claimant]);
      published += 1;
      metrics().observe(METRICS.workerProcessingDuration, performance.now() - startedAt, {
        eventType: event.eventType,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown consumer failure';
      const willDeadLetter = row.attempt_count >= maxAttempts;

      try {
        await workerQuery('SELECT shared.fail_outbox_event($1, $2, $3, $4::interval, $5)', [
          row.id,
          claimant,
          reason.slice(0, 1000),
          backoffInterval(row.attempt_count, {
            baseMs: config.OUTBOX_BASE_BACKOFF_MS,
            maxMs: config.OUTBOX_MAX_BACKOFF_MS,
            ...(options.random ? { random: options.random } : {}),
          }),
          maxAttempts,
        ]);
      } catch (failError) {
        // The claim is still ours; the lease will re-queue it. Losing the failure
        // bookkeeping must not lose the event.
        captureException(failError, {
          correlationId: row.correlation_id ?? '00000000-0000-4000-8000-000000000000',
          module: 'outbox-worker',
          operation: 'outbox.fail',
          tenantRef: row.tenant_id,
        });
        return;
      }

      if (willDeadLetter) {
        deadLettered += 1;
        await recordDeadLetter(row, reason);
      } else {
        retried += 1;
        metrics().increment(METRICS.outboxRetryCount, { eventType: event.eventType });
      }
    }
  });

  return { claimed: rows.length, published, retried, deadLettered };
}

/**
 * Long-running loop with graceful shutdown.
 *
 * `stop()` stops new claims immediately and resolves once the in-flight batch
 * finishes or the grace period expires — whichever comes first.
 */
export class OutboxWorker {
  private running = false;
  private stopping = false;
  private inFlight: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: WorkerOptions = {}) {}

  /** True while the loop is claiming. Used by the readiness probe. */
  isRunning(): boolean {
    return this.running && !this.stopping;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    const pollInterval = backendConfig().OUTBOX_POLL_INTERVAL_MS;

    while (!this.stopping) {
      this.inFlight = processOutboxBatch(this.options);
      try {
        const result = (await this.inFlight) as ProcessResult;
        if (result.claimed === 0) await this.sleep(pollInterval);
      } catch (error) {
        captureException(error, {
          correlationId: '00000000-0000-4000-8000-000000000000',
          module: 'outbox-worker',
          operation: 'outbox.batch',
        });
        // Back off on a batch-level failure so a broken database does not spin.
        await this.sleep(pollInterval);
      }
    }
    this.running = false;
  }

  /** Stops claiming and waits for the current batch, bounded by the grace period. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopping = true;
    const grace = backendConfig().OUTBOX_SHUTDOWN_GRACE_MS;
    await Promise.race([this.inFlight.catch(() => undefined), this.sleep(grace)]);
    log.info('Outbox worker stopped', {
      module: 'outbox-worker',
      operation: 'worker.stop',
      result: 'success',
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // Never hold the process open just to wait for the next poll.
      if (typeof timer.unref === 'function') timer.unref();
    });
  }
}
