/**
 * Outbox delivery guarantees (P1-13-BE-016, P1-13-BE-017, BR-INT-002).
 *
 * Delivery is at-least-once, and that is not an apology — it is the only honest
 * guarantee a durable queue can give across a crash. Everything in this suite
 * exists because "at-least-once" is only safe if each of the following holds,
 * and each of them fails silently when it does not:
 *
 *  - **No double ownership.** Two workers must never both hold the same row.
 *    `FOR UPDATE SKIP LOCKED` in `shared.claim_outbox_events` is the mechanism;
 *    an in-process mutex would say nothing about the other instance, which is
 *    why the claim protocol is the database's and the assertion is on two
 *    genuinely concurrent claims.
 *  - **No loss on crash.** A worker that dies mid-flight must release its claim.
 *    Asserted by claiming with a deliberately short lease, never completing, and
 *    proving a second worker can pick the row up again.
 *  - **Exactly-once effect.** `shared.processed_events` has PK
 *    `(consumer_code, event_id)` and the marker is written in the SAME
 *    transaction as the consumer's side effects, so a redelivery aborts the whole
 *    attempt. The assertion counts the DURABLE side effect, because the consumer
 *    callback legitimately runs again on redelivery — what must not happen twice
 *    is the committed effect.
 *  - **No retry storm, and poison messages stop.** A permanently failing event
 *    must back off (not spin) and must eventually stop being retried, landing in
 *    `dead_letter` with an operational record rather than consuming the queue
 *    forever.
 *  - **Graceful shutdown loses nothing.** Stopping must stop *claiming* first and
 *    then drain what is already claimed.
 *
 * Publication runs on the DBCR-P1-13-001 rehearsal role (the producer writes in
 * its own transaction); processing runs on the worker archetype, which is the
 * only role the frozen schema grants the queue tables.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  crRehearsalPool,
  dropCrRehearsalRole,
  ensureBackendFixtures,
  ensureCrRehearsalRole,
  ensureTestLogins,
  workerAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { __resetCapabilitiesForTests } from '@/server/db/capabilities';
import { publishEvent } from '@/server/events/publisher';
import {
  SYSTEM_ACTOR_ID,
  __setWorkerPoolForTests,
  withWorkerTransaction,
  workerQuery,
  type WorkerDb,
} from '@/server/worker/worker-db';
import {
  __resetConsumersForTests,
  registerConsumer,
  runConsumer,
  type ConsumedEvent,
} from '@/server/worker/consumer-registry';
import { OutboxWorker, processOutboxBatch, queueHealth } from '@/server/worker/outbox-worker';

const EVENT_TYPE = 'document.accepted';
const CONSUMER_CODE = 'fx_p1_13_consumer';
const SIDE_EFFECT_CODE = 'fx_p1_13_applied';

let admin: Pool;
let rehearsal: Pool;
let worker: Pool;

interface PublishedEvent {
  readonly id: string;
  readonly aggregateId: string;
}

async function publishEvents(count: number, tag: string): Promise<PublishedEvent[]> {
  return withTransaction(contextFor({}), async (db) => {
    const published: PublishedEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      const aggregateId = randomUUID();
      const result = await publishEvent(db, {
        eventType: EVENT_TYPE,
        aggregateId,
        aggregateVersion: 1,
        producer: 'shared',
        payload: { index },
        eventKey: `fx_p1_13_${tag}_${index}_${randomUUID()}`,
      });
      published.push({ id: result.eventId, aggregateId });
    }
    return published;
  });
}

/**
 * The consumer's durable side effect. A `shared.error_records` row is used
 * because it is the one table the worker archetype may write that carries a
 * free-form code — the point is that the effect survives COMMIT, not what it is.
 */
async function recordSideEffect(db: WorkerDb, event: ConsumedEvent): Promise<void> {
  await db.query(
    `INSERT INTO shared.error_records
       (tenant_id, error_code, source, operation, severity, retryable, context, created_by)
     VALUES ($1, $2, 'test_consumer', 'consume', 'info', false, $3::jsonb, $4)`,
    [event.tenantId, SIDE_EFFECT_CODE, JSON.stringify({ eventId: event.id }), SYSTEM_ACTOR_ID]
  );
}

async function sideEffectCount(): Promise<number> {
  return countRows(admin, 'shared.error_records', 'tenant_id = $1 AND error_code = $2', [
    TENANT_A,
    SIDE_EFFECT_CODE,
  ]);
}

async function outboxRow(id: string): Promise<{
  status: string;
  attempt_count: number;
  claimed_by: string | null;
  available_at: Date;
  created_at: Date;
  last_error: string | null;
} | null> {
  const result = await admin.query<{
    status: string;
    attempt_count: number;
    claimed_by: string | null;
    available_at: Date;
    created_at: Date;
    last_error: string | null;
  }>(
    `SELECT status, attempt_count, claimed_by, available_at, created_at, last_error
       FROM shared.event_outbox WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

function toConsumedEvent(published: PublishedEvent): ConsumedEvent {
  return {
    id: published.id,
    tenantId: TENANT_A,
    eventType: EVENT_TYPE,
    schemaVersion: 1,
    aggregateType: 'shared.document',
    aggregateId: published.aggregateId,
    aggregateVersion: 1,
    correlationId: null,
    causationId: null,
    payload: {},
    headers: {},
    attemptCount: 0,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition was not met before the timeout');
    await delay(10);
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await ensureCrRehearsalRole(admin);
  rehearsal = crRehearsalPool();
  worker = workerAppPool(6);
  __setPrimaryPoolForTests(rehearsal);
  __setWorkerPoolForTests(worker);
});

beforeEach(async () => {
  __resetConsumersForTests();
  __resetCapabilitiesForTests();
  await admin.query('DELETE FROM shared.processed_events WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM shared.error_records WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM shared.event_outbox WHERE tenant_id = $1', [TENANT_A]);
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __setWorkerPoolForTests(undefined);
  await rehearsal.end();
  await worker.end();
  await cleanBackendFixtures(admin);
  await dropCrRehearsalRole(admin);
  await admin.end();
});

describe('claiming is exclusive', () => {
  it('never hands the same row to two concurrently claiming workers', async () => {
    const published = await publishEvents(6, 'claim');

    const [first, second] = await Promise.all([
      workerQuery<{ id: string }>(
        'SELECT id FROM shared.claim_outbox_events($1, $2, $3::interval)',
        ['fx_claimant_a', 6, '60 seconds']
      ),
      workerQuery<{ id: string }>(
        'SELECT id FROM shared.claim_outbox_events($1, $2, $3::interval)',
        ['fx_claimant_b', 6, '60 seconds']
      ),
    ]);

    const a = new Set(first.rows.map((row) => row.id));
    const b = new Set(second.rows.map((row) => row.id));
    const overlap = [...a].filter((id) => b.has(id));

    expect(overlap).toEqual([]);
    expect(a.size + b.size).toBeLessThanOrEqual(published.length);
    // Every claimed row is owned by exactly one claimant, recorded durably.
    for (const id of [...a, ...b]) {
      const row = await outboxRow(id);
      expect(row?.status).toBe('claimed');
      expect(['fx_claimant_a', 'fx_claimant_b']).toContain(row?.claimed_by);
    }
  });
});

describe('a successful consumer publishes the event exactly once', () => {
  it('marks the row published and writes the processed-events marker', async () => {
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async (event, db) => {
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    const [published] = await publishEvents(1, 'success');
    expect(published).toBeDefined();

    const result = await processOutboxBatch({
      claimant: 'fx_success_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 3,
      leaseSeconds: 60,
    });

    expect(result).toEqual({ claimed: 1, published: 1, retried: 0, deadLettered: 0 });

    const row = await outboxRow((published as PublishedEvent).id);
    expect(row?.status).toBe('published');
    expect(row?.claimed_by).toBeNull();

    expect(
      await countRows(admin, 'shared.processed_events', 'consumer_code = $1 AND event_id = $2', [
        CONSUMER_CODE,
        (published as PublishedEvent).id,
      ])
    ).toBe(1);
    expect(await sideEffectCount()).toBe(1);
  });
});

describe('redelivery to the same consumer has no second effect', () => {
  it('reports already-processed and leaves exactly one committed side effect', async () => {
    const consumer = registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async (event, db) => {
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    const [published] = await publishEvents(1, 'redelivery');
    const event = toConsumedEvent(published as PublishedEvent);

    const first = await runConsumer(consumer, event);
    expect(first.status).toBe('applied');
    expect(await sideEffectCount()).toBe(1);

    // The same event, delivered again — exactly what at-least-once means.
    const second = await runConsumer(consumer, event);
    expect(second.status).toBe('already-processed');

    // The callback ran a second time; its transaction did not commit.
    expect(await sideEffectCount()).toBe(1);
    expect(
      await countRows(admin, 'shared.processed_events', 'consumer_code = $1 AND event_id = $2', [
        CONSUMER_CODE,
        event.id,
      ])
    ).toBe(1);
  });

  it('reports an unsupported schema version rather than applying it', async () => {
    const consumer = registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [2],
      handle: async (event, db) => {
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    const [published] = await publishEvents(1, 'version');
    const outcome = await runConsumer(consumer, toConsumedEvent(published as PublishedEvent));

    expect(outcome.status).toBe('unsupported-version');
    expect(await sideEffectCount()).toBe(0);
  });
});

describe('a permanently failing event backs off and then dead-letters', () => {
  it('delays the retry, exhausts the ceiling, and records the dead letter', async () => {
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async () => {
        throw new Error('downstream is unavailable');
      },
    });

    const [published] = await publishEvents(1, 'deadletter');
    const eventId = (published as PublishedEvent).id;

    const first = await processOutboxBatch({
      claimant: 'fx_failing_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 2,
      leaseSeconds: 60,
      // Near the top of the full-jitter window, so the delay is observable.
      random: () => 0.9,
    });
    expect(first).toEqual({ claimed: 1, published: 0, retried: 1, deadLettered: 0 });

    const afterFirst = await outboxRow(eventId);
    expect(afterFirst?.status).toBe('pending');
    expect(afterFirst?.attempt_count).toBe(1);
    expect(afterFirst?.last_error).toContain('downstream is unavailable');
    expect(afterFirst?.claimed_by).toBeNull();
    // The retry was scheduled into the future, not made immediately claimable.
    expect((afterFirst as { available_at: Date }).available_at.getTime()).toBeGreaterThan(
      (afterFirst as { created_at: Date }).created_at.getTime()
    );

    // Proof the backoff is enforced by the queue and not merely recorded:
    // claiming again right now finds nothing due.
    const tooSoon = await processOutboxBatch({
      claimant: 'fx_failing_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 2,
      leaseSeconds: 60,
      random: () => 0,
    });
    expect(tooSoon.claimed).toBe(0);

    await delay(700);

    const second = await processOutboxBatch({
      claimant: 'fx_failing_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 2,
      leaseSeconds: 60,
      random: () => 0,
    });
    expect(second).toEqual({ claimed: 1, published: 0, retried: 0, deadLettered: 1 });

    const afterSecond = await outboxRow(eventId);
    expect(afterSecond?.status).toBe('dead_letter');
    expect(afterSecond?.attempt_count).toBe(2);

    expect(
      await countRows(admin, 'shared.error_records', 'tenant_id = $1 AND error_code = $2', [
        TENANT_A,
        'outbox.dead_letter',
      ])
    ).toBe(1);
    // A dead-lettered event is terminal: it is never claimed again.
    const afterTerminal = await processOutboxBatch({
      claimant: 'fx_failing_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 2,
      leaseSeconds: 60,
    });
    expect(afterTerminal.claimed).toBe(0);
  });
});

describe('an abandoned claim returns to the queue', () => {
  it('becomes claimable again once the lease expires', async () => {
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async (event, db) => {
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    const [published] = await publishEvents(1, 'lease');
    const eventId = (published as PublishedEvent).id;

    // A worker claims the row and then "crashes": it never completes or fails it.
    const claimed = await workerQuery<{ id: string }>(
      'SELECT id FROM shared.claim_outbox_events($1, $2, $3::interval)',
      ['fx_crashed_worker', 5, '1 second']
    );
    expect(claimed.rows.map((row) => row.id)).toContain(eventId);
    expect((await outboxRow(eventId))?.status).toBe('claimed');

    // Before the lease expires the row is nobody else's to take.
    const early = await processOutboxBatch({
      claimant: 'fx_recovery_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 3,
      leaseSeconds: 60,
    });
    expect(early.claimed).toBe(0);

    await delay(1_300);

    const recovered = await processOutboxBatch({
      claimant: 'fx_recovery_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 3,
      leaseSeconds: 1,
    });
    expect(recovered.claimed).toBe(1);
    expect(recovered.published).toBe(1);
    expect((await outboxRow(eventId))?.status).toBe('published');
    expect(await sideEffectCount()).toBe(1);
  });
});

describe('queue health is measurable', () => {
  it('reports depth, oldest pending age, and dead letters', async () => {
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async () => {
        throw new Error('downstream is unavailable');
      },
    });

    await publishEvents(3, 'health');

    const pending = await withWorkerTransaction((db) => queueHealth(db));
    expect(pending.depth).toBe(3);
    expect(pending.oldestAgeSeconds).toBeGreaterThanOrEqual(0);
    expect(pending.deadLetterCount).toBe(0);

    // One attempt with a ceiling of one dead-letters immediately.
    const result = await processOutboxBatch({
      claimant: 'fx_health_worker',
      batchSize: 3,
      concurrency: 1,
      maxAttempts: 1,
      leaseSeconds: 60,
      random: () => 0,
    });
    expect(result.deadLettered).toBe(3);

    const drained = await withWorkerTransaction((db) => queueHealth(db));
    expect(drained.depth).toBe(0);
    expect(drained.deadLetterCount).toBe(3);
  });
});

describe('graceful shutdown', () => {
  it('drains the in-flight batch instead of losing a claimed event', async () => {
    let entered = 0;
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async (event, db) => {
        entered += 1;
        // Long enough that stop() is called while this event is claimed.
        await delay(200);
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    const [published] = await publishEvents(1, 'shutdown');
    const eventId = (published as PublishedEvent).id;

    const outboxWorker = new OutboxWorker({
      claimant: 'fx_shutdown_worker',
      batchSize: 5,
      concurrency: 1,
      maxAttempts: 3,
      leaseSeconds: 60,
    });

    const loop = outboxWorker.start();
    await waitUntil(() => entered > 0);
    expect(outboxWorker.isRunning()).toBe(true);

    await outboxWorker.stop();
    await loop;

    expect(outboxWorker.isRunning()).toBe(false);
    // The claimed event completed rather than being abandoned mid-flight.
    expect((await outboxRow(eventId))?.status).toBe('published');
    expect(
      await countRows(admin, 'shared.processed_events', 'consumer_code = $1 AND event_id = $2', [
        CONSUMER_CODE,
        eventId,
      ])
    ).toBe(1);
    expect(await sideEffectCount()).toBe(1);
  });
});
