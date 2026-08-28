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
 * Publication runs on the runtime archetype (the producer writes in its own
 * transaction); processing runs on the worker archetype. Keeping the two
 * identities apart is the point: after DBCR-P1-13-001 the runtime may INSERT an
 * envelope for its own tenant and nothing more — claiming, completing, and
 * failing remain the worker's alone, across every tenant.
 *
 * ============================================================================
 * THE QUEUE IS SHARED; DELETING THIS SUITE'S TENANT DOES NOT EMPTY IT
 * ============================================================================
 * `shared.claim_outbox_events` is deliberately NOT tenant-scoped — infrastructure
 * dispatch must be independent of any user tenant session — so every worker
 * started here claims across the whole database. Removing TENANT_A's rows in
 * `beforeEach` therefore leaves the queue non-empty: any OTHER tenant's row that
 * is due, or that is `claimed` under an expired lease, is still claimable and is
 * handed straight to this suite's workers.
 *
 * That is not hypothetical. A reception acceptance run left seven stuck
 * `claimed` rows behind under its own fixture tenant, and this suite went red
 * with count mismatches that named no cause at all — `expected 12 to be less
 * than or equal to 6`, `claimed: 5 ... expected claimed: 1`. Worse than the red:
 * the batches that did "succeed" marked five of that tenant's undelivered events
 * `published` and took ownership of two more. A suite that silently discards
 * another tenant's delivery obligations is a bigger defect than the one it was
 * reporting.
 *
 * Two mechanisms answer it, and neither touches the concurrency assertions:
 *
 *  - **Quarantine** (`beforeEach`). Every non-terminal row belonging to another
 *    tenant is locked `FOR UPDATE` by a transaction held open for the duration of
 *    the test. `SKIP LOCKED` — the very mechanism that makes claiming exclusive —
 *    then makes those rows invisible to every claim this suite issues. Nothing is
 *    deleted, rewritten, or "neutralised": foreign rows are left exactly as
 *    found, which is what lets the regression case below assert precisely that.
 *  - **Ownership and deltas in the assertions.** Batch assertions name the ids the
 *    test itself published. `queueHealth` is a whole-database gauge BY DESIGN, so
 *    it is asserted as a delta against a baseline taken after quarantine — an
 *    absolute count would only ever be an assertion about an empty database.
 *
 * The suite deliberately runs with a foreign tenant's claimable rows planted in
 * `beforeAll` — one due `pending`, one `claimed` under a long-expired lease, the
 * two shapes the claim predicate fires on. Every test here therefore also proves
 * the isolation, and the final describe block proves it directly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
  workerAppPool,
} from './helpers';
import { DATABASE_LEASE_KEY } from '../../scripts/lib/database-lease.mjs';
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
import {
  OutboxWorker,
  processOutboxBatch as processOutboxBatchUnguarded,
  queueHealth,
} from '@/server/worker/outbox-worker';

const EVENT_TYPE = 'document.accepted';
const CONSUMER_CODE = 'fx_p1_13_consumer';
const SIDE_EFFECT_CODE = 'fx_p1_13_applied';

/**
 * A tenant this suite does not own, used to keep foreign claimable rows in the
 * queue at all times. Deliberately NOT TENANT_B: `cleanFixtures` cascades that
 * one away, and this fixture has to behave like somebody else's data — present,
 * claimable, and none of this suite's business.
 */
const FOREIGN_TENANT = 'f0000000-0000-4000-8000-00000000000f';
const FOREIGN_TENANT_CODE = 'fx_p1_13_foreign';
/** The claimant recorded on the planted stale claim. Never used by this suite. */
const FOREIGN_CLAIMANT = 'fx_foreign_worker';

let admin: Pool;
let runtime: Pool;
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
    // Envelope scope and authorship. The claim already returned these — the
    // outbox function is `RETURNS SETOF shared.event_outbox` — and `toEvent` now
    // forwards them instead of dropping them, so a consumer no longer needs the
    // publisher to repeat them in a payload.
    companyId: null,
    branchId: null,
    createdBy: USER_A,
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

// ---------------------------------------------------------------------------
// Isolation from rows this suite does not own. See the header.
// ---------------------------------------------------------------------------

/** Ids of the planted foreign rows: one due `pending`, one stale `claimed`. */
let foreignEventIds: readonly string[] = [];
/** The open transaction whose row locks hold foreign rows out of every claim. */
let quarantine: PoolClient | undefined;
/** Ids the current test's quarantine actually covers. Asserted, not assumed. */
let quarantinedIds: readonly string[] = [];
/**
 * The same ids, kept for the WHOLE test rather than for the life of the lock.
 *
 * `releaseQuarantine` clears `quarantinedIds`, and the isolation case below
 * deliberately releases the quarantine so it can probe what the claimer would
 * really hand over. Deriving "a foreign row arrived" from the cleared list makes
 * every pre-existing row look like an arrival, so the detector fires on the one
 * case whose entire purpose is to look at those rows. This is the snapshot the
 * detector compares against, and it survives the release.
 */
let snapshotIds: readonly string[] = [];

/**
 * Plants the two shapes of row `shared.claim_outbox_events` treats as claimable,
 * under a tenant that is not this suite's:
 *
 *   1. `pending` and due — `available_at <= now()`;
 *   2. `claimed` under a lease that expired an hour ago — the shape an abandoned
 *      worker leaves behind, and exactly what the acceptance run left.
 *
 * The event type is the one this suite's consumer handles, on purpose: if either
 * row ever reached a batch here, a consumer would run against another tenant's
 * event and commit a side effect for it. The `BEFORE INSERT` guard refuses a
 * forged lifecycle state, so the stale claim is stamped by a follow-up UPDATE —
 * which is also how the real row got into that state.
 */
async function plantForeignEvents(): Promise<readonly string[]> {
  await admin.query(
    `INSERT INTO org.tenants
       (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES ($1, $2, 'P1-13 foreign outbox fixture', 'active', 'en', 'UTC', $3)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_TENANT, FOREIGN_TENANT_CODE, USER_A]
  );

  const insert = async (key: string): Promise<string> => {
    const result = await admin.query<{ id: string }>(
      `INSERT INTO shared.event_outbox
         (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
          aggregate_version, producer, payload, created_by)
       VALUES ($1, $2, $3, 'shared.document', gen_random_uuid(), 1, 1, 'shared', '{}'::jsonb, $4)
       RETURNING id`,
      [FOREIGN_TENANT, key, EVENT_TYPE, SYSTEM_ACTOR_ID]
    );
    const row = result.rows[0];
    if (!row) throw new Error('foreign outbox fixture was not inserted');
    return row.id;
  };

  const duePending = await insert(`${FOREIGN_TENANT_CODE}_due_${randomUUID()}`);
  const staleClaimed = await insert(`${FOREIGN_TENANT_CODE}_stale_${randomUUID()}`);
  await admin.query(
    `UPDATE shared.event_outbox
        SET status = 'claimed',
            claimed_at = now() - interval '1 hour',
            claimed_by = $2,
            attempt_count = 1
      WHERE id = $1`,
    [staleClaimed, FOREIGN_CLAIMANT]
  );

  return [duePending, staleClaimed];
}

/** Removes the foreign fixture, children first — the tenant FK is RESTRICT. */
async function removeForeignFixture(): Promise<void> {
  await admin.query('DELETE FROM shared.processed_events WHERE tenant_id = $1', [FOREIGN_TENANT]);
  await admin.query('DELETE FROM shared.error_records WHERE tenant_id = $1', [FOREIGN_TENANT]);
  await admin.query('DELETE FROM shared.event_outbox WHERE tenant_id = $1', [FOREIGN_TENANT]);
  await admin.query('DELETE FROM org.tenants WHERE id = $1', [FOREIGN_TENANT]);
}

/**
 * Holds every non-terminal row of every other tenant out of this suite's claims.
 *
 * The lock is the whole mechanism: `claim_outbox_events` selects its candidates
 * `FOR UPDATE SKIP LOCKED`, so a row already locked by this transaction is not a
 * candidate at all. Terminal rows (`published`, `dead_letter`) are never
 * claimable and are left alone; rows whose `available_at` is still in the future
 * ARE locked anyway, because a backoff or a lease can come due mid-test.
 *
 * Returns the ids it covers, so a test can assert that coverage rather than
 * trust it — a quarantine that silently matched nothing would look from the
 * outside exactly like a quarantine that worked.
 */
async function quarantineForeignEvents(): Promise<readonly string[]> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    // This transaction stays open for the length of one test. Being reaped
    // mid-test would drop the locks without a word — the silent failure mode
    // this whole mechanism exists to remove.
    await client.query('SET LOCAL idle_in_transaction_session_timeout = 0');
    // If another session holds these rows, say so within five seconds rather
    // than hanging to the hook timeout and reporting nothing about the cause.
    await client.query("SET LOCAL lock_timeout = '5s'");
    const held = await client.query<{ id: string }>(
      `SELECT id
         FROM shared.event_outbox
        WHERE tenant_id <> $1
          AND status IN ('pending', 'claimed')
        ORDER BY id
          FOR UPDATE`,
      [TENANT_A]
    );
    quarantine = client;
    return held.rows.map((row) => row.id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    quarantine = undefined;
    const reason = error instanceof Error ? error.message : 'unknown failure';
    throw new Error(
      'could not quarantine the outbox rows belonging to other tenants; this suite claims across ' +
        `every tenant and cannot be isolated without it: ${reason}`
    );
  }
}

/**
 * The EXCLUSIVE LEASE on the shared database, and why row locks are not enough.
 *
 * ## The architectural limit the quarantine has
 *
 * A row lock can hold a row that EXISTS. It cannot hold a row that does not
 * exist yet. So the quarantine below is a snapshot: it covers every foreign
 * non-terminal row at the moment the test starts, and a producer writing one
 * millisecond later writes a row this suite’s workers will happily claim,
 * consume and mark `published` — taking ownership of somebody else’s delivery
 * obligation, which is the exact defect the quarantine was built to stop.
 *
 * That is not a bug in the quarantine. It is the honest limit of the mechanism,
 * and no amount of additional sweeping fixes it: another sweep is another
 * snapshot.
 *
 * ## What replaces the promise
 *
 * A LEASE. This suite takes an exclusive advisory lock on the shared database
 * before it does anything, holds it for the whole run, and REFUSES TO RUN if it
 * cannot have it. Every other harness that writes to this database takes the
 * same lock through the same key — the acceptance provisioning scripts under
 * `.local/` do, and the key lives here so there is one definition of it.
 *
 * A lease is a protocol between harnesses, and a protocol only binds those who
 * speak it. So it is backed by DETECTION: every claim this suite issues first
 * asks whether a foreign non-terminal row has appeared that the quarantine does
 * not cover, and ABORTS — before the claim, not after — if one has. The suite
 * then fails loudly with a cause instead of quietly publishing another tenant’s
 * event.
 *
 * The two together are the honest guarantee: a foreign producer is excluded if
 * it speaks the protocol, and stops the suite if it does not. Neither promises
 * that a stranger cannot write — nothing this side of an isolated database can
 * promise that, and claiming it would be the false statement.
 */
// Imported, never re-declared: a second harness inventing its own number takes
// a lease nobody else respects, which is the same as taking none.
// (see `scripts/lib/database-lease.mjs` for the protocol)

/** The connection holding the lease. Held for the whole run, released in afterAll. */
let lease: PoolClient | undefined;

async function acquireDatabaseLease(): Promise<void> {
  const client = await admin.connect();
  const held = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [DATABASE_LEASE_KEY]
  );
  if (held.rows[0]?.locked !== true) {
    client.release();
    throw new Error(
      'REFUSING TO RUN: another harness holds the RootLco shared-database lease ' +
        `(advisory key ${DATABASE_LEASE_KEY}). ` +
        'This suite claims across EVERY tenant, so running it beside another writer means ' +
        'claiming and publishing events that are not its own. Stop the other harness, or run this suite against an isolated database.'
    );
  }
  lease = client;
}

async function releaseDatabaseLease(): Promise<void> {
  const client = lease;
  lease = undefined;
  if (!client) return;
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [DATABASE_LEASE_KEY]);
  } finally {
    client.release();
  }
}

/**
 * Foreign non-terminal rows the quarantine does NOT cover.
 *
 * Anything here arrived after the snapshot was taken, which means a producer
 * that does not hold the lease is writing to this database right now.
 */
async function foreignArrivals(): Promise<readonly string[]> {
  const result = await admin.query<{ id: string }>(
    `SELECT id
       FROM shared.event_outbox
      WHERE tenant_id <> $1
        AND status IN ('pending', 'claimed')
        AND NOT (id = ANY($2::uuid[]))
      ORDER BY id`,
    [TENANT_A, [...snapshotIds]]
  );
  return result.rows.map((row) => row.id);
}

/**
 * The guard. Called BEFORE every claim this suite issues, never after.
 *
 * After is too late: by then the row has been claimed, the consumer has run and
 * the marker is committed. The whole value of the check is that it stands
 * between the arrival and the claim.
 */
async function refuseIfForeignProducerIsWriting(): Promise<void> {
  const arrivals = await foreignArrivals();
  if (arrivals.length === 0) return;
  throw new Error(
    'ABORTING: a foreign producer wrote to the shared outbox while this suite held the ' +
      `database lease — ${arrivals.length} row(s) outside the quarantine: ${arrivals.join(', ')}. ` +
      'They are NOT claimable by this suite: claiming them would publish another tenant’s events. Whatever is writing does not take the lease.'
  );
}

/**
 * Every batch this suite processes, guarded.
 *
 * The production function is imported under its real name and wrapped here
 * rather than at ten call sites, so a case added tomorrow gets the guard by
 * writing the obvious thing. The guard runs BEFORE the batch: a foreign row that
 * arrived after the quarantine snapshot must stop the suite, not be discovered
 * in it afterwards when the consumer has already committed a side effect and
 * the row is already `published`.
 */
async function processOutboxBatch(
  ...args: Parameters<typeof processOutboxBatchUnguarded>
): ReturnType<typeof processOutboxBatchUnguarded> {
  await refuseIfForeignProducerIsWriting();
  return processOutboxBatchUnguarded(...args);
}

/** Releases the quarantine. Rolling back a lock-only transaction changes no row. */
async function releaseQuarantine(): Promise<void> {
  const client = quarantine;
  quarantine = undefined;
  quarantinedIds = [];
  if (!client) return;
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

/**
 * Claims as this suite's worker would, then rolls back — so the result is real
 * evidence about what the queue would hand over, and leaves nothing behind.
 */
/**
 * How many rows a claimer could take right now that this suite does not own.
 *
 * The probe below has to reach the PLANTED rows to prove they are claimable,
 * and `claim_outbox_events` hands back the oldest first. A fixed batch size is
 * therefore a guess about how much foreign residue the queue holds: with the
 * acceptance environment provisioned this database carries 55 older pending
 * rows, so a batch of ten never got near the plant and the proof failed for a
 * reason that had nothing to do with isolation.
 *
 * Counting both non-terminal statuses over-estimates — a claimed row under a
 * LIVE lease is not claimable — and over-estimating is the safe direction: the
 * limit only has to be large enough to reach.
 */
async function claimableElsewhere(): Promise<number> {
  const result = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM shared.event_outbox
      WHERE tenant_id <> $1
        AND status IN ('pending', 'claimed')`,
    [TENANT_A]
  );
  return Number(result.rows[0]?.n ?? 0);
}
async function claimWithoutCommitting(claimant: string, limit: number): Promise<string[]> {
  await refuseIfForeignProducerIsWriting();
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ id: string }>(
      'SELECT id FROM shared.claim_outbox_events($1, $2, $3::interval)',
      [claimant, limit, '60 seconds']
    );
    return claimed.rows.map((row) => row.id);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

interface OutboxState {
  readonly id: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly claimed_by: string | null;
  readonly claimed_at: Date | null;
  readonly published_at: Date | null;
  readonly last_error: string | null;
}

/** Every mutable lifecycle field of the foreign fixture, for exact comparison. */
async function foreignEventStates(): Promise<OutboxState[]> {
  const result = await admin.query<OutboxState>(
    `SELECT id, status, attempt_count, claimed_by, claimed_at, published_at, last_error
       FROM shared.event_outbox
      WHERE tenant_id = $1
      ORDER BY id`,
    [FOREIGN_TENANT]
  );
  return result.rows;
}

beforeAll(async () => {
  admin = adminPool();
  // FIRST, before anything is read or written: this suite claims across every
  // tenant, so running it beside another writer is not a flake, it is data loss.
  await acquireDatabaseLease();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  // A previous run that died before afterAll leaves the fixture behind, and the
  // plant is deterministic, so start from a known absence.
  await removeForeignFixture();
  foreignEventIds = await plantForeignEvents();
  runtime = runtimeAppPool();
  worker = workerAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setWorkerPoolForTests(worker);
});

beforeEach(async () => {
  __resetConsumersForTests();
  __resetCapabilitiesForTests();
  await admin.query('DELETE FROM shared.processed_events WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM shared.error_records WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM shared.event_outbox WHERE tenant_id = $1', [TENANT_A]);
  // Deleting this suite's own rows does NOT empty the queue: the claim function
  // spans every tenant. Whatever is left belongs to somebody else, and is locked
  // out of reach for the length of this test.
  quarantinedIds = await quarantineForeignEvents();
  snapshotIds = quarantinedIds;
});

afterEach(async () => {
  await releaseQuarantine();
});

afterAll(async () => {
  await releaseDatabaseLease();
  __setPrimaryPoolForTests(undefined);
  __setWorkerPoolForTests(undefined);
  await runtime.end();
  await worker.end();
  await removeForeignFixture();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('claiming is exclusive', () => {
  it('never hands the same row to two concurrently claiming workers', async () => {
    const published = await publishEvents(6, 'claim');
    const owned = new Set(published.map((event) => event.id));

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
    // Nothing entered either batch that this test did not publish. The claim
    // function is not tenant-scoped, so without this the count assertion below
    // is a statement about whatever else happens to be in the database.
    expect([...a, ...b].filter((id) => !owned.has(id))).toEqual([]);
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

describe('the harness boundary is a lease, and it fails closed', () => {
  /*
   * The architectural finding, driven rather than described.
   *
   * A row lock quarantines rows that EXIST. A producer writing one after the
   * snapshot writes a row this suite would claim, consume and mark `published` —
   * taking ownership of another tenant’s delivery obligation. No additional
   * sweep fixes that, because another sweep is another snapshot.
   *
   * So the suite holds an exclusive lease and refuses to run without it, and
   * every claim is guarded by a check for rows that arrived outside the
   * snapshot. These cases drive both halves and, most importantly, prove the row
   * is left EXACTLY as the intruder wrote it.
   */
  const INTRUDER_TENANT = 'f0000000-0000-4000-8000-00000000000e';

  async function intrude(): Promise<string> {
    await admin.query(
      `INSERT INTO org.tenants
         (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
       VALUES ($1, 'fx_p1_13_intruder', 'P1-13 mid-run producer', 'active', 'en', 'UTC', $2)
       ON CONFLICT (id) DO NOTHING`,
      [INTRUDER_TENANT, USER_A]
    );
    const inserted = await admin.query<{ id: string }>(
      `INSERT INTO shared.event_outbox
         (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
          aggregate_version, producer, payload, created_by)
       VALUES ($1, $2, $3, 'shared.document', gen_random_uuid(), 1, 1, 'shared', '{}'::jsonb, $4)
       RETURNING id`,
      [INTRUDER_TENANT, `fx_intruder_${randomUUID()}`, EVENT_TYPE, SYSTEM_ACTOR_ID]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('the intruding row was not inserted');
    return row.id;
  }

  async function removeIntruder(): Promise<void> {
    await admin.query('DELETE FROM shared.processed_events WHERE tenant_id = $1', [
      INTRUDER_TENANT,
    ]);
    await admin.query('DELETE FROM shared.error_records WHERE tenant_id = $1', [INTRUDER_TENANT]);
    await admin.query('DELETE FROM shared.event_outbox WHERE tenant_id = $1', [INTRUDER_TENANT]);
    await admin.query('DELETE FROM org.tenants WHERE id = $1', [INTRUDER_TENANT]);
  }

  afterEach(async () => {
    await removeIntruder();
  });

  it('aborts BEFORE processing when a foreign row arrives mid-run', async () => {
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async (event: ConsumedEvent, db: WorkerDb) => {
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    const intruderId = await intrude();

    /*
     * The claim never happens. Not "happens and is then noticed" — the guard
     * stands between the arrival and the claim, which is the only position from
     * which it can prevent anything.
     */
    await expect(
      processOutboxBatch({
        claimant: 'fx_intruded_worker',
        batchSize: 10,
        concurrency: 1,
        maxAttempts: 3,
        leaseSeconds: 60,
      })
    ).rejects.toThrow(/foreign producer wrote to the shared outbox/);

    // …and the row is EXACTLY as the intruder left it: not claimed, not
    // published, not neutralised, not deleted to make a count come out.
    const after = await admin.query<{ status: string; claimed_by: string | null }>(
      'SELECT status, claimed_by FROM shared.event_outbox WHERE id = $1',
      [intruderId]
    );
    expect(after.rows[0]?.status).toBe('pending');
    expect(after.rows[0]?.claimed_by).toBeNull();
    expect(
      await countRows(admin, 'shared.processed_events', 'tenant_id = $1', [INTRUDER_TENANT]),
      'the intruder’s event was consumed'
    ).toBe(0);
  });

  it('refuses the probe path too, so no claim route bypasses the boundary', async () => {
    await intrude();
    await expect(claimWithoutCommitting('fx_intruded_probe', 50)).rejects.toThrow(
      /foreign producer wrote to the shared outbox/
    );
  });

  it('holds an EXCLUSIVE lease, so a second harness cannot run beside it', async () => {
    /*
     * The other half of the boundary, driven against the real lock. A second
     * connection asking for the same key must be refused while this run holds it
     * — which is what makes "refuse to run" a mechanism rather than a docblock.
     */
    const rival = await admin.connect();
    try {
      const attempt = await rival.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [DATABASE_LEASE_KEY]
      );
      expect(
        attempt.rows[0]?.locked,
        'a second harness took the lease while this suite was running'
      ).toBe(false);
    } finally {
      rival.release();
    }
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

    // `queueHealth` gauges the WHOLE queue on purpose — a dispatcher's depth is
    // not a per-tenant number — so what this test owns is the movement, not the
    // level. Taken after quarantine, the baseline cannot move under it.
    const baseline = await withWorkerTransaction((db) => queueHealth(db));

    await publishEvents(3, 'health');

    const pending = await withWorkerTransaction((db) => queueHealth(db));
    expect(pending.depth).toBe(baseline.depth + 3);

    /*
     * The age, against a value only the DATABASE can answer.
     *
     * This read `expect(pending.oldestAgeSeconds).toBeGreaterThanOrEqual(0)`,
     * which no database state can fail. The gauge is built as
     * `Math.max(0, Math.round(Number(row?.oldest_age_seconds ?? 0)))`, so it is
     * `>= 0` for every row the query can return and for no row at all — an
     * assertion that passes whether the gauge works, returns nothing, or is
     * deleted.
     *
     * What is asserted instead is that the gauge REPORTS THE OLDEST ROW. The
     * age of the oldest claimable row is computed here from
     * `shared.event_outbox` against the database's own clock — never the test
     * runner's, which is a second clock and the classic source of a flake — and
     * the gauge has to agree with it to the second.
     */
    const measured = await admin.query<{ age: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (now() - min(occurred_at)))::numeric AS age
         FROM shared.event_outbox
        WHERE status IN ('pending', 'claimed')`
    );
    const oldest = Number(measured.rows[0]?.age ?? -1);
    expect(oldest, 'no claimable row exists, so the gauge has nothing to report').toBeGreaterThan(
      -1
    );
    // One second of tolerance for the two reads, and no more: a gauge that
    // reported a constant, or the wrong row, is outside it immediately.
    expect(Math.abs(pending.oldestAgeSeconds - Math.round(oldest))).toBeLessThanOrEqual(1);

    expect(pending.deadLetterCount).toBe(baseline.deadLetterCount);

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
    expect(drained.depth).toBe(baseline.depth);
    expect(drained.deadLetterCount).toBe(baseline.deadLetterCount + 3);
  });

  it('reports the age of the OLDEST claimable row, not of the newest', async () => {
    /*
     * The half the comparison above cannot make: a gauge pinned to the LAST row
     * agrees with a freshly published queue every time. Planting a row two hours
     * old and watching the reported age jump is what separates "reads the oldest"
     * from "reads something".
     *
     * In its own case because it publishes a row, and the case above counts
     * exactly three. Sharing a case with it made the drained-depth assertion
     * fail by one — which is the same class of defect as the vacuous assertion
     * this replaced, wearing the opposite face.
     */
    const aged = await publishEvents(1, 'health-aged');
    await admin.query(
      "UPDATE shared.event_outbox SET occurred_at = now() - interval '2 hours' WHERE id = $1",
      [aged[0]!.id]
    );

    const older = await withWorkerTransaction((db) => queueHealth(db));
    expect(older.oldestAgeSeconds).toBeGreaterThanOrEqual(7100);

    /*
     * And the mutation that proves the assertion is about the OLDEST: with the
     * planted row aged forward again to now, the reported age has to come back
     * down to whatever the real oldest row is.
     */
    await admin.query('UPDATE shared.event_outbox SET occurred_at = now() WHERE id = $1', [
      aged[0]!.id,
    ]);
    const measured = await admin.query<{ age: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (now() - min(occurred_at)))::numeric AS age
         FROM shared.event_outbox
        WHERE status = 'pending'`
    );
    const back = await withWorkerTransaction((db) => queueHealth(db));
    expect(
      Math.abs(back.oldestAgeSeconds - Math.round(Number(measured.rows[0]?.age ?? -1)))
    ).toBeLessThanOrEqual(1);
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

    // The worker loop claims on its own schedule, so the guard runs before it is
    // allowed to start rather than around a call this test makes.
    await refuseIfForeignProducerIsWriting();
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

describe("another tenant's claimable rows cannot enter this suite", () => {
  it('claims only what it published, and leaves the foreign rows exactly as found', async () => {
    registerConsumer({
      code: CONSUMER_CODE,
      handles: [EVENT_TYPE],
      supportedSchemaVersions: [1],
      handle: async (event, db) => {
        await recordSideEffect(db, event);
        return 'applied';
      },
    });

    // The quarantine covers the plant. A quarantine that matched nothing would
    // look identical from the outside, so its coverage is asserted, not assumed.
    expect(quarantinedIds).toEqual(expect.arrayContaining([...foreignEventIds]));

    const planted = await foreignEventStates();
    expect(planted).toHaveLength(2);
    // One due `pending`, one `claimed` under a lease that expired an hour ago.
    expect(planted.map((row) => row.status).sort()).toEqual(['claimed', 'pending']);

    // 1. The plant is genuinely claimable — proven by the queue rather than
    //    asserted by this file. With the quarantine lifted, `claim_outbox_events`
    //    hands both foreign rows to a worker of this suite: the defect, live. The
    //    claim is rolled back, so the rows are left as they were found.
    await releaseQuarantine();
    /*
     * Reach is DERIVED. The claimer returns the oldest rows first, so the
     * batch has to span whatever foreign residue the database happens to
     * hold — 55 acceptance rows sit ahead of the plant when the acceptance
     * environment is provisioned, and a fixed ten never reached it.
     */
    const reach = (await claimableElsewhere()) + 1;
    const wouldClaim = await claimWithoutCommitting('fx_isolation_probe', reach);
    expect(wouldClaim).toEqual(expect.arrayContaining([...foreignEventIds]));
    quarantinedIds = await quarantineForeignEvents();
    expect(await foreignEventStates()).toEqual(planted);

    // 2. With the quarantine in force, the same worker sees only this suite's
    //    row — the exact counts every other test in this file depends on.
    const [published] = await publishEvents(1, 'isolation');
    const eventId = (published as PublishedEvent).id;

    const result = await processOutboxBatch({
      claimant: 'fx_isolation_worker',
      batchSize: 10,
      concurrency: 2,
      maxAttempts: 3,
      leaseSeconds: 60,
    });
    expect(result).toEqual({ claimed: 1, published: 1, retried: 0, deadLettered: 0 });
    expect((await outboxRow(eventId))?.status).toBe('published');
    expect(await sideEffectCount()).toBe(1);

    // 3. Two concurrent claims — the exclusivity path — are equally unaffected:
    //    each row goes to exactly one claimant, and only owned rows are in play.
    const contested = await publishEvents(2, 'isolation_concurrent');
    const contestedIds = new Set(contested.map((event) => event.id));
    const [first, second] = await Promise.all([
      workerQuery<{ id: string }>(
        'SELECT id FROM shared.claim_outbox_events($1, $2, $3::interval)',
        ['fx_isolation_a', 10, '60 seconds']
      ),
      workerQuery<{ id: string }>(
        'SELECT id FROM shared.claim_outbox_events($1, $2, $3::interval)',
        ['fx_isolation_b', 10, '60 seconds']
      ),
    ]);
    const claimedIds = [...first.rows, ...second.rows].map((row) => row.id);
    expect(claimedIds.filter((id) => !contestedIds.has(id))).toEqual([]);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);

    // 4. The foreign rows are untouched — not claimed, not retried, and above
    //    all not marked published. Silently publishing another tenant's
    //    undelivered events is what the unfixed suite actually did.
    expect(await foreignEventStates()).toEqual(planted);
    expect(await countRows(admin, 'shared.error_records', 'tenant_id = $1', [FOREIGN_TENANT])).toBe(
      0
    );
    expect(
      await countRows(admin, 'shared.processed_events', 'tenant_id = $1', [FOREIGN_TENANT])
    ).toBe(0);
  });
});
