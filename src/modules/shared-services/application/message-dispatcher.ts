/**
 * Outbound-message dispatch — worker side (P1-15).
 *
 * Runs on `app_worker`, which is the only archetype the schema grants
 * `shared.delivery_attempts` and the `outbound_messages` UPDATE to. The request
 * runtime holds neither, so a request **cannot** claim a message was sent, forge
 * an attempt, or mark one delivered. That separation is the security property
 * this class exists to keep.
 *
 * ## Content arrives with the call, and is verified against the stored digest
 *
 * `app_worker` has no privilege on `shared.template_versions` and the message row
 * stores no body, so the dispatcher cannot render. The rendered content is
 * produced at enqueue and handed in; before contacting a provider the dispatcher
 * recomputes its SHA-256 and compares it with `body_sha256`. A mismatch is
 * refused — which makes the stored digest load-bearing instead of decorative,
 * and means content that was tampered with in transit between enqueue and
 * dispatch cannot be delivered.
 *
 * ## Lifecycle
 *
 *   pending → queued → sending → sent → delivered
 *                          ↘ failed → queued (retry, bounded)
 *                                   ↘ cancelled (dead letter)
 *
 * Every edge above is one `guard_outbound_message_lifecycle()` accepts; no other
 * edge is reachable from here, and the guard rejects any attempt to write a
 * lifecycle timestamp or `retry_count` directly.
 */
import { createHash } from 'node:crypto';
import { log } from '@/server/observability/logger';
import { metrics, METRICS } from '@/server/observability/metrics';
import { backendConfig } from '@/server/config/backend-config';
import type { WorkerDb } from '@/server/worker/worker-db';
import {
  DISPATCH_TRANSITIONS,
  MessageDispatchRepository,
  type DispatchCandidate,
} from '../data/message-dispatch-repository';
import {
  MessageProviderError,
  messageProvider,
  type MessageProvider,
} from '../provider/message-provider';
import { canonicalRenderedForm, type RenderedMessage } from '../domain/template-rendering';

export interface DispatchInput {
  readonly tenantId: string;
  readonly messageId: string;
  /** Transient rendered content produced at enqueue. Never persisted, never logged. */
  readonly rendered: RenderedMessage;
  /** Opaque recipient reference the adapter resolves. Never an address. */
  readonly recipientRef: string;
}

export type DispatchResult =
  | { readonly outcome: 'delivered'; readonly attemptNumber: number }
  | { readonly outcome: 'failed'; readonly attemptNumber: number; readonly retryable: boolean }
  | { readonly outcome: 'dead-lettered'; readonly attemptNumber: number }
  | { readonly outcome: 'skipped'; readonly reason: string };

export class MessageDispatcher {
  constructor(
    private readonly repository: MessageDispatchRepository,
    private readonly provider: () => MessageProvider = messageProvider
  ) {}

  /** Moves `pending` messages to `queued`. Returns how many were promoted. */
  async promotePending(db: WorkerDb, limit: number): Promise<number> {
    const candidates = await this.repository.claim(db, 'pending', limit);
    let promoted = 0;
    for (const candidate of candidates) {
      const moved = await this.repository.transition(db, {
        tenantId: candidate.tenant_id,
        messageId: candidate.id,
        ...DISPATCH_TRANSITIONS.queue,
      });
      promoted += moved;
    }
    return promoted;
  }

  /**
   * Attempts one delivery.
   *
   * The whole attempt is recorded whatever happens: a `started` row before the
   * provider call would need a second UPDATE the schema does not grant, so the
   * attempt is written once, after the outcome is known, with the completion
   * timestamp the CHECK requires. A crash mid-provider-call therefore leaves the
   * message in `sending` with no attempt row — which is exactly the state a
   * recovery sweep should look for, and is honest about what is unknown.
   */
  async dispatchOne(db: WorkerDb, input: DispatchInput): Promise<DispatchResult> {
    const config = backendConfig();
    const message = await this.repository.find(db, input.tenantId, input.messageId);
    if (!message) return { outcome: 'skipped', reason: 'not-found' };
    if (message.status !== 'queued') {
      return { outcome: 'skipped', reason: `status-${message.status}` };
    }

    const digest = createHash('sha256')
      .update(canonicalRenderedForm(input.rendered), 'utf8')
      .digest();
    if (!digest.equals(message.body_sha256)) {
      // Refused, not delivered and not retried: the content on hand is not the
      // content that was approved and hashed at enqueue.
      const attemptNumber = await this.failWith(db, message, {
        summary: 'content_digest_mismatch',
        failureClass: 'integrity',
        from: 'queued',
      });
      return { outcome: 'failed', attemptNumber, retryable: false };
    }

    const started = await this.repository.transition(db, {
      tenantId: message.tenant_id,
      messageId: message.id,
      ...DISPATCH_TRANSITIONS.start,
    });
    if (started === 0) return { outcome: 'skipped', reason: 'lost-race' };

    const attemptNumber = await this.repository.nextAttemptNumber(
      db,
      message.tenant_id,
      message.id
    );
    const provider = this.provider();

    try {
      const outcome = await this.withTimeout(
        provider.deliver({
          messageId: message.id,
          channel: message.channel,
          recipientRef: input.recipientRef,
          subject: input.rendered.subject,
          body: input.rendered.body,
        }),
        config.NOTIFICATION_PROVIDER_TIMEOUT_MS
      );

      await this.repository.recordAttempt(db, {
        tenantId: message.tenant_id,
        messageId: message.id,
        attemptNumber,
        providerCode: provider.code,
        status: outcome.accepted ? 'delivered' : 'accepted',
        providerMessageRef: outcome.providerMessageRef,
        responseCode: outcome.responseCode,
      });

      await this.repository.transition(db, {
        tenantId: message.tenant_id,
        messageId: message.id,
        ...DISPATCH_TRANSITIONS.sent,
      });
      await this.repository.transition(db, {
        tenantId: message.tenant_id,
        messageId: message.id,
        ...DISPATCH_TRANSITIONS.delivered,
      });

      metrics().increment(METRICS.notificationDeliveryCount, {
        channel: message.channel,
        provider: provider.code,
        result: 'delivered',
      });
      this.logAttempt(message, provider.code, attemptNumber, 'delivered');
      return { outcome: 'delivered', attemptNumber };
    } catch (error) {
      const failure =
        error instanceof MessageProviderError
          ? error
          : new MessageProviderError('provider fault', 'outage', 'unclassified_provider_fault');

      await this.repository.recordAttempt(db, {
        tenantId: message.tenant_id,
        messageId: message.id,
        attemptNumber,
        providerCode: provider.code,
        status: 'errored',
        // A sanitised summary, never the provider's own message: that message
        // routinely echoes the destination back.
        errorSummary: failure.summary,
      });
      await this.repository.transition(db, {
        tenantId: message.tenant_id,
        messageId: message.id,
        ...DISPATCH_TRANSITIONS.failFromSending,
        failureClass: failure.kind,
      });

      metrics().increment(METRICS.notificationDeliveryCount, {
        channel: message.channel,
        provider: provider.code,
        result: failure.kind,
      });
      this.logAttempt(message, provider.code, attemptNumber, failure.kind);

      if (!failure.retryable || message.retry_count + 1 >= config.OUTBOX_MAX_ATTEMPTS) {
        await this.deadLetter(db, message, failure.kind);
        return { outcome: 'dead-lettered', attemptNumber };
      }
      return { outcome: 'failed', attemptNumber, retryable: true };
    }
  }

  /**
   * Requeues a failed message for another attempt.
   *
   * `retry_count` is incremented by the lifecycle guard, not here, so the count
   * cannot be inflated or reset by a caller. The bound is
   * `OUTBOX_MAX_ATTEMPTS` — the same ceiling the outbox worker uses, because a
   * second, different retry budget is a second thing to get wrong.
   */
  async retry(db: WorkerDb, tenantId: string, messageId: string): Promise<boolean> {
    const config = backendConfig();
    const message = await this.repository.find(db, tenantId, messageId);
    if (!message || message.status !== 'failed') return false;
    if (message.retry_count + 1 >= config.OUTBOX_MAX_ATTEMPTS) {
      await this.deadLetter(db, message, 'retry_budget_exhausted');
      return false;
    }
    const moved = await this.repository.retry(db, tenantId, messageId);
    if (moved > 0) {
      metrics().increment(METRICS.notificationRetryCount, { channel: message.channel });
    }
    return moved > 0;
  }

  /**
   * Ends a message's life as undeliverable.
   *
   * `cancelled` is the schema's terminal failure state and the CHECK permits
   * `failure_class` there, so the reason survives. Nothing is deleted: a
   * dead-lettered message stays queryable with its full attempt history, which
   * is what an operator needs to decide whether to re-request it.
   */
  private async deadLetter(
    db: WorkerDb,
    message: DispatchCandidate,
    failureClass: string
  ): Promise<void> {
    await this.repository.transition(db, {
      tenantId: message.tenant_id,
      messageId: message.id,
      ...DISPATCH_TRANSITIONS.deadLetter,
      failureClass,
    });
    metrics().increment(METRICS.notificationDeadLetterCount, {
      channel: message.channel,
      reason: failureClass,
    });
    log.warn('Outbound message dead-lettered', {
      module: 'shared-services',
      operation: 'notification.dispatch',
      correlationId: message.id,
      result: 'failure',
      context: { channel: message.channel, failureClass, retryCount: message.retry_count },
    });
  }

  private async failWith(
    db: WorkerDb,
    message: DispatchCandidate,
    input: { summary: string; failureClass: string; from: string }
  ): Promise<number> {
    const attemptNumber = await this.repository.nextAttemptNumber(
      db,
      message.tenant_id,
      message.id
    );
    await this.repository.transition(db, {
      tenantId: message.tenant_id,
      messageId: message.id,
      from: input.from,
      to: 'sending',
    });
    await this.repository.recordAttempt(db, {
      tenantId: message.tenant_id,
      messageId: message.id,
      attemptNumber,
      providerCode: this.provider().code,
      status: 'errored',
      errorSummary: input.summary,
    });
    await this.repository.transition(db, {
      tenantId: message.tenant_id,
      messageId: message.id,
      ...DISPATCH_TRANSITIONS.failFromSending,
      failureClass: input.failureClass,
    });
    await this.deadLetter(db, message, input.failureClass);
    return attemptNumber;
  }

  /**
   * Bounds a provider call.
   *
   * A provider that never answers must not hold a worker slot forever; the timer
   * is cleared on both paths so a resolved call does not keep the process alive.
   */
  private async withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, rejectWith) => {
          timer = setTimeout(
            () =>
              rejectWith(
                new MessageProviderError('provider timed out', 'timeout', 'provider_timeout')
              ),
            ms
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Channel, provider, attempt number, outcome. Never content or recipient. */
  private logAttempt(
    message: DispatchCandidate,
    providerCode: string,
    attemptNumber: number,
    outcome: string
  ): void {
    log.info('Delivery attempt recorded', {
      module: 'shared-services',
      operation: 'notification.dispatch',
      correlationId: message.id,
      result: outcome === 'delivered' ? 'success' : 'failure',
      context: { channel: message.channel, provider: providerCode, attemptNumber, outcome },
    });
  }
}
