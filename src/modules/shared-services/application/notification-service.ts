/**
 * Notification enqueue — the P1-13 `NotificationService` implementation (P1-15).
 *
 * Enqueue-first, with no provider call anywhere in the source transaction. The
 * durable outcome of a successful call is one `shared.outbound_messages` row in
 * state `pending`; everything after that belongs to the worker on a different
 * database role. A provider call inside the business transaction would hold a
 * database transaction open across a network round trip and make the business
 * write's durability depend on a third party's availability.
 *
 * ## Content is rendered here and is deliberately not stored
 *
 * `outbound_messages.body_sha256` is documented in the schema as the "integrity
 * digest of rendered content that is not persisted here", and `app_worker` holds
 * **no privilege at all** on `shared.template_versions` — so the worker cannot
 * re-render, and the design is not that it should. Rendering happens once, at
 * enqueue, from an approved immutable version; the digest is stored; the content
 * is handed to the dispatcher in process.
 *
 * `queueMessageWithRendering()` is how a caller gets the rendered content;
 * `queueMessage()` is the frozen signature and returns only the queue result.
 *
 * **Residual risk, stated rather than hidden:** with no durable transient
 * content store, content lost from process memory cannot be reproduced by
 * another process. The row still proves the message was requested and carries
 * its digest and lifecycle — but cross-process redelivery of content is not
 * implemented and is not claimed.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { log } from '@/server/observability/logger';
import { metrics, METRICS } from '@/server/observability/metrics';
import { backendConfig } from '@/server/config/backend-config';
import type {
  NotificationService,
  QueuedMessage,
  QueueMessageInput,
} from '@/server/contracts/notification-service';
import { NotificationRepository } from '../data/notification-repository';
import { TemplateRepository } from '../data/template-repository';
import {
  assertConsent,
  assertDedupeKey,
  assertRecipientReference,
  assertSupportedChannel,
  bodyDigest,
  NotificationPolicyError,
  recipientDigest,
  assertTemplateUsable,
} from '../domain/notification-policy';
import {
  canonicalRenderedForm,
  renderTemplate,
  TemplateRenderError,
  type RenderedMessage,
} from '../domain/template-rendering';

export interface QueuedWithRendering {
  readonly queued: QueuedMessage;
  /**
   * The rendered content. **Transient**: hand it to the dispatcher, never log
   * it, never persist it, never return it from an HTTP handler.
   */
  readonly rendered: RenderedMessage;
}

export class SharedNotificationService
  extends ApplicationService
  implements NotificationService
{
  protected readonly module = 'shared-services';

  constructor(
    private readonly messages: NotificationRepository,
    private readonly templates: TemplateRepository
  ) {
    super();
  }

  async queueMessage(db: DbHandle, input: QueueMessageInput): Promise<QueuedMessage> {
    return (await this.queueMessageWithRendering(db, input)).queued;
  }

  async queueMessageWithRendering(
    db: DbHandle,
    input: QueueMessageInput
  ): Promise<QueuedWithRendering> {
    const config = backendConfig();
    const context = this.contextOf(db);

    let channel;
    let dedupeKey;
    let recipientRef;
    try {
      channel = assertSupportedChannel(input.channel);
      dedupeKey = assertDedupeKey(input.dedupeKey);
      recipientRef = assertRecipientReference(input.recipientRef);
      assertConsent(input.consentEvaluation, new Date());
    } catch (error) {
      throw this.translatePolicy(error);
    }

    const version = await this.templates.findVersion(db, input.templateVersionId);
    if (!version) {
      throw new AppFailure('ERR-RES-001', {
        message: 'Template version not found or not visible to this tenant',
      });
    }
    try {
      assertTemplateUsable(
        {
          versionId: version.id,
          versionStatus: version.status,
          templateTenantId: version.template_tenant_id,
          channel: version.template_channel,
          localeCode: version.template_locale,
          purpose: version.template_purpose,
        },
        { channel, locale: input.locale, tenantId: context.principal.tenantId }
      );
    } catch (error) {
      throw this.translatePolicy(error);
    }

    let rendered: RenderedMessage;
    try {
      rendered = renderTemplate(
        { subject: version.subject, body: version.body },
        input.variables,
        { channel, maxRenderedChars: config.NOTIFICATION_MAX_RENDERED_CHARS }
      );
    } catch (error) {
      metrics().increment(METRICS.templateRenderFailureCount, {
        channel,
        rule: error instanceof TemplateRenderError ? error.rule : 'unknown',
      });
      throw this.translateRender(error);
    }

    // A reference that names a user in this tenant is stored as such — the FK is
    // composite on (tenant_id, id), so it cannot point at another tenant's user.
    // Anything else is stored only as a tenant-salted digest, so the ledger never
    // holds a reversible external identity.
    const isUser = await this.messages.isTenantUser(db, recipientRef);
    const result = await this.messages.enqueue(db, {
      id: crypto.randomUUID(),
      channel,
      purpose: version.template_purpose,
      templateVersionId: version.id,
      recipientUserId: isUser ? recipientRef : null,
      recipientDigest: isUser ? null : recipientDigest(context.principal.tenantId, recipientRef),
      bodySha256: bodyDigest(canonicalRenderedForm(rendered)),
      dedupeKey,
      consentRef: input.consentEvaluation.consentRecordId,
      companyId: input.companyId ?? context.companyIds[0] ?? null,
      branchId: input.branchId ?? null,
    });

    if (!result) {
      // The INSERT policy refused it: no `shared.notification.send` in scope.
      throw new AppFailure('ERR-IAM-001', { message: 'Enqueue was refused by policy' });
    }

    if (result.deduplicated) {
      metrics().increment(METRICS.notificationEnqueueCount, { channel, result: 'deduplicated' });
      log.info('Outbound message already enqueued for this dedupe key', {
        module: this.module,
        operation: db.context.operation,
        correlationId: db.context.correlationId,
        result: 'skipped',
        context: { channel },
      });
      return { queued: { messageId: result.messageId, deduplicated: true }, rendered };
    }

    await appendAudit(db, {
      action: 'shared.notification.enqueued',
      entityType: 'shared.outbound_message',
      entityId: result.messageId,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
      details: [
        { field: 'channel', classification: 'public', value: channel },
        { field: 'purpose', classification: 'public', value: version.template_purpose },
        { field: 'locale', classification: 'public', value: input.locale },
        { field: 'template_version_id', classification: 'internal', value: version.id },
        // The dedupe key routinely encodes a business identity, and the recipient
        // is a person. Both are recorded as `restricted`, which `iam.audit_mask`
        // collapses to a fixed marker before storage — the audit proves the
        // message was requested without becoming a copy of who it was for.
        { field: 'dedupe_key', classification: 'restricted', value: dedupeKey },
        { field: 'recipient_ref', classification: 'restricted', value: recipientRef },
        {
          field: 'consent_record_id',
          classification: 'internal',
          value: input.consentEvaluation.consentRecordId,
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'message.enqueued',
      aggregateId: result.messageId,
      aggregateVersion: 1,
      producer: 'shared.notifications',
      // No recipient, no content, no dedupe key: an event travels further than
      // the row it describes.
      payload: { channel, purpose: version.template_purpose, locale: input.locale },
      eventKey: `message.enqueued:${result.messageId}`,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
    });

    metrics().increment(METRICS.notificationEnqueueCount, { channel, result: 'success' });
    log.info('Outbound message enqueued', {
      module: this.module,
      operation: db.context.operation,
      correlationId: db.context.correlationId,
      result: 'success',
      // Channel and purpose only: no recipient, no subject, no dedupe key.
      context: { channel, purpose: version.template_purpose, locale: input.locale },
    });

    return { queued: { messageId: result.messageId, deduplicated: false }, rendered };
  }

  /** Maps a policy refusal to the catalog. */
  private translatePolicy(error: unknown): unknown {
    if (!(error instanceof NotificationPolicyError)) return error;
    if (error.rule === 'consent_not_granted' || error.rule === 'consent_stale') {
      return new AppFailure('ERR-NTF-001', { message: error.message, cause: error });
    }
    return new AppFailure('ERR-VAL-001', {
      message: error.message,
      safeDetails: { violations: [{ path: 'body', rule: error.rule }] },
      cause: error,
    });
  }

  private translateRender(error: unknown): unknown {
    if (!(error instanceof TemplateRenderError)) return error;
    return new AppFailure('ERR-VAL-001', {
      message: error.message,
      // Placeholder NAMES are safe to return — they are template metadata the
      // caller already knows. Values never are, and none is included.
      safeDetails: {
        violations: error.names.length
          ? error.names.map((name) => ({ path: `body.variables.${name}`, rule: error.rule }))
          : [{ path: 'body.variables', rule: error.rule }],
      },
      cause: error,
    });
  }
}
