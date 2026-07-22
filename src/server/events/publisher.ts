/**
 * Transactional outbox publisher (P1-13-BE-015, BR-INT-001).
 *
 * `publishEvent()` writes one row into `shared.event_outbox` using the caller's
 * transaction handle. That is the whole pattern: the event row and the business
 * state change share a commit, so an event exists **if and only if** the
 * transaction that produced it committed. There is no "publish after commit"
 * path, because that is precisely the window where a crash loses the event.
 *
 * Publication to consumers is the worker's job (`worker/outbox-worker.ts`).
 * Nothing here talks to a broker: the database outbox is the queue in this
 * phase, and a broker would add an unproven delivery path alongside a proven one.
 *
 * `event_key` is unique per tenant, so a producer that retries its own command
 * cannot emit the same event twice — publication is idempotent at the database
 * level rather than by convention.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';
import { isSqlState, SQLSTATE } from '../db/repository';
import { buildEventEnvelope, type BuildEnvelopeInput, type EventEnvelope } from './envelope';
import { requireCapability } from '../db/require-capability';

export interface PublishResult {
  readonly eventId: string;
  readonly envelope: EventEnvelope;
  /** True when the key already existed and the row was not written again. */
  readonly deduplicated: boolean;
}

/**
 * Writes an event into the producer's transaction.
 *
 * The correlation ID always comes from the request context, never from the
 * caller: an event that claims a different correlation than the request that
 * produced it breaks the trace it exists to provide.
 */
export async function publishEvent(
  db: DbHandle,
  input: Omit<BuildEnvelopeInput, 'correlationId' | 'causationId'> & {
    readonly causationId?: string | null;
  }
): Promise<PublishResult> {
  await requireCapability(db, 'outbox.publish');

  const envelope = buildEventEnvelope({
    ...input,
    correlationId: db.context.correlationId,
    causationId: input.causationId ?? db.context.causationId,
  });

  try {
    const result = await db.query<{ id: string }>(
      `INSERT INTO shared.event_outbox
         (tenant_id, company_id, branch_id, event_key, event_type, aggregate_type,
          aggregate_id, schema_version, aggregate_version, producer, occurred_at,
          correlation_id, causation_id, payload, headers, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)
       RETURNING id`,
      [
        db.context.principal.tenantId,
        envelope.companyId,
        envelope.branchId,
        envelope.eventKey,
        envelope.eventType,
        envelope.aggregateType,
        envelope.aggregateId,
        envelope.schemaVersion,
        envelope.aggregateVersion,
        envelope.producer,
        envelope.occurredAt,
        envelope.correlationId,
        envelope.causationId,
        JSON.stringify(envelope.payload),
        JSON.stringify(envelope.headers),
        db.context.principal.userId,
      ]
    );

    const id = result.rows[0]?.id;
    if (!id) {
      throw new AppFailure('ERR-SYS-001', { message: 'Outbox insert returned no id' });
    }
    return { eventId: id, envelope, deduplicated: false };
  } catch (error) {
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // Same (tenant, event_key) already published. Deduplication is the intended
      // behaviour, but the violation aborts this transaction — so it is surfaced
      // as a conflict rather than swallowed, and the caller decides.
      throw new AppFailure('ERR-INT-001', {
        message: `Event key "${envelope.eventKey}" was already published for this tenant`,
      });
    }
    throw error;
  }
}
