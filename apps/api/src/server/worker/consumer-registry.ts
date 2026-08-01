/**
 * Consumer registry and consumer idempotency (P1-13-BE-017, BR-INT-002).
 *
 * Delivery is at-least-once. That is not a limitation to apologise for — it is
 * the only honest guarantee a durable queue can give across a crash — but it
 * means **every consumer must be idempotent**, and the foundation makes that
 * structural rather than aspirational:
 *
 *  - `shared.processed_events` has PRIMARY KEY `(consumer_code, event_id)`;
 *  - `runConsumer()` inserts that row **in the same transaction** as the
 *    consumer's side effects, before committing. A redelivery hits the primary
 *    key, the transaction aborts, and the whole attempt — marker and side
 *    effects together — is discarded. The event is then reported as already
 *    processed rather than applied twice.
 *
 * Inserting the marker *after* the side effects in the same transaction is
 * equivalent to inserting it before (both commit or neither does) and keeps the
 * `outcome` column truthful: it records what actually happened.
 */
import { isSqlState, SQLSTATE } from '../db/repository';
import { SYSTEM_ACTOR_ID, withWorkerTransaction, type WorkerDb } from './worker-db';

/** The outcomes `shared.processed_events.outcome` accepts. */
export type ConsumerOutcome = 'applied' | 'skipped' | 'failed';

export interface ConsumedEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly payload: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
  readonly attemptCount: number;
}

export interface Consumer {
  /** Matches `^[a-z][a-z0-9_.]{1,62}$` — the `processed_events` format contract. */
  readonly code: string;
  /** Event types this consumer handles. */
  readonly handles: readonly string[];
  /** Schema versions understood. An unknown version is a poison message. */
  readonly supportedSchemaVersions: readonly number[];
  /** Applies the side effects. Must be safe to abort at any point. */
  handle(event: ConsumedEvent, db: WorkerDb): Promise<ConsumerOutcome>;
}

const CONSUMER_CODE = /^[a-z][a-z0-9_.]{1,62}$/;

const consumers = new Map<string, Consumer>();

export class ConsumerRegistrationError extends Error {
  public override readonly name = 'ConsumerRegistrationError';
}

export function registerConsumer(consumer: Consumer): Consumer {
  if (!CONSUMER_CODE.test(consumer.code)) {
    throw new ConsumerRegistrationError(
      `Consumer code "${consumer.code}" must match ^[a-z][a-z0-9_.]{1,62}$ ` +
        '(shared.processed_events.consumer_code contract).'
    );
  }
  if (consumers.has(consumer.code)) {
    throw new ConsumerRegistrationError(`Consumer "${consumer.code}" is already registered.`);
  }
  if (consumer.handles.length === 0) {
    throw new ConsumerRegistrationError(`Consumer "${consumer.code}" handles no event types.`);
  }
  consumers.set(consumer.code, consumer);
  return consumer;
}

/** Consumers subscribed to an event type, in deterministic order. */
export function consumersFor(eventType: string): readonly Consumer[] {
  return [...consumers.values()]
    .filter((consumer) => consumer.handles.includes(eventType))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function allConsumers(): readonly Consumer[] {
  return [...consumers.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function __resetConsumersForTests(): void {
  consumers.clear();
}

export type RunConsumerResult =
  | { readonly status: 'applied' | 'skipped'; readonly consumer: string }
  | { readonly status: 'already-processed'; readonly consumer: string }
  | { readonly status: 'unsupported-version'; readonly consumer: string };

/**
 * Runs one consumer against one event, atomically with its idempotency marker.
 *
 * An unsupported schema version is reported rather than applied: silently
 * ignoring a payload shape you do not understand is how a consumer skips half a
 * migration and nobody notices.
 */
export async function runConsumer(
  consumer: Consumer,
  event: ConsumedEvent
): Promise<RunConsumerResult> {
  if (!consumer.supportedSchemaVersions.includes(event.schemaVersion)) {
    return { status: 'unsupported-version', consumer: consumer.code };
  }

  try {
    return await withWorkerTransaction(async (db) => {
      const outcome = await consumer.handle(event, db);
      await db.query(
        `INSERT INTO shared.processed_events
           (consumer_code, event_id, tenant_id, outcome, metadata, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          consumer.code,
          event.id,
          event.tenantId,
          outcome,
          JSON.stringify({ attempt: event.attemptCount }),
          SYSTEM_ACTOR_ID,
        ]
      );
      return { status: outcome === 'failed' ? 'skipped' : outcome, consumer: consumer.code };
    });
  } catch (error) {
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // The marker already existed: this is a redelivery. The transaction rolled
      // back, so the side effects of THIS attempt were discarded — the earlier
      // successful attempt's effects remain. Exactly-once effect, at-least-once
      // delivery.
      return { status: 'already-processed', consumer: consumer.code };
    }
    throw error;
  }
}

/** True when the consumer has already processed the event. Read-only probe. */
export async function hasProcessed(
  db: WorkerDb,
  consumerCode: string,
  eventId: string
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM shared.processed_events
        WHERE consumer_code = $1 AND event_id = $2
     ) AS exists`,
    [consumerCode, eventId]
  );
  return result.rows[0]?.exists === true;
}
