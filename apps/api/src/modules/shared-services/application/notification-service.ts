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
  EnqueuePreparedInput,
  NotificationService,
  PrepareNotificationInput,
  PreparedNotification,
  QueuedMessage,
  QueueMessageInput,
} from '@/server/contracts/notification-service';
import type { WorkerDb } from '@/server/worker/worker-db';
import { NotificationRepository } from '../data/notification-repository';
import { TemplateRepository } from '../data/template-repository';
import { MessageDispatchRepository } from '../data/message-dispatch-repository';
import {
  assertConsent,
  assertDedupeKey,
  assertRecipientReference,
  assertSupportedChannel,
  bodyDigest,
  isSupportedChannel,
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

export class SharedNotificationService extends ApplicationService implements NotificationService {
  protected readonly module = 'shared-services';

  constructor(
    private readonly messages: NotificationRepository,
    private readonly templates: TemplateRepository,
    private readonly dispatch: MessageDispatchRepository
  ) {
    super();
  }

  async queueMessage(db: DbHandle, input: QueueMessageInput): Promise<QueuedMessage> {
    return (await this.queueMessageWithRendering(db, input)).queued;
  }

  /**
   * Resolves a notification to immutable facts without enqueueing it.
   *
   * The whole point is WHERE this runs: on `app_runtime`, inside the tenant's own
   * RLS, where reading a template and rendering it are legal. It renders only to
   * compute the digest and then lets the rendered content fall out of scope — the
   * platform's rule is that rendered content is never persisted, and an event
   * payload is persistence.
   */
  async prepareNotification(
    db: DbHandle,
    input: PrepareNotificationInput
  ): Promise<PreparedNotification | null> {
    const config = backendConfig();
    const context = this.contextOf(db);

    let dedupeKey;
    let recipientRef;
    try {
      dedupeKey = assertDedupeKey(input.dedupeKey);
      recipientRef = assertRecipientReference(input.recipientUserId);
      // Applied HERE, not at the worker. The worker inserts directly and never
      // calls `assertConsent`, so if this is not the gate then there is none.
      assertConsent(input.consentEvaluation, new Date());
    } catch (error) {
      throw this.translatePolicy(error);
    }

    const supported = input.channels.filter((c) => isSupportedChannel(c));
    if (supported.length === 0) return null;

    const version = await this.templates.findActiveVersionByCode(
      db,
      input.templateCode,
      supported as readonly string[]
    );
    // NOT an error. No message template ships with this platform, so an unseeded
    // tenant reaches here on the ordinary path; a caller must not fail its own
    // operation because content was never authored.
    if (version === null) return null;

    const channel = assertSupportedChannel(version.template_channel as never);
    try {
      assertTemplateUsable(
        {
          versionId: version.id,
          versionStatus: version.status,
          templateStatus: version.template_status,
          templateTenantId: version.template_tenant_id,
          channel: version.template_channel,
          localeCode: version.template_locale,
          purpose: version.template_purpose,
        },
        // `locale` is the row's own, so that comparison is a tautology here and is
        // not evidence of anything — said plainly rather than left to look like a
        // check. What actually constrains the choice is the query: the channel is
        // one the caller offered, the template code is exact, and the row is the
        // tenant's own or the platform default it shadows. The status, tenant and
        // channel comparisons below are the load-bearing ones.
        { channel, locale: version.template_locale, tenantId: context.principal.tenantId }
      );
    } catch {
      // A disabled template or an unapproved version is a DATA STATE too. The
      // request path throws here because a caller asked to send this exact
      // message; a publisher only asked whether one was due.
      return null;
    }

    let rendered: RenderedMessage;
    try {
      rendered = renderTemplate({ subject: version.subject, body: version.body }, input.variables, {
        channel,
        maxRenderedChars: config.NOTIFICATION_MAX_RENDERED_CHARS,
      });
    } catch (error) {
      metrics().increment(METRICS.templateRenderFailureCount, {
        channel,
        rule: error instanceof TemplateRenderError ? error.rule : 'unknown',
      });
      throw this.translateRender(error);
    }

    return {
      templateVersionId: version.id,
      channel,
      purpose: version.template_purpose,
      recipientUserId: recipientRef,
      // Hex, not a Buffer: this crosses into a `jsonb` payload, and a Buffer would
      // come back as an object. The digest is computed from the rendered content
      // and the content is discarded with this scope.
      bodySha256: bodyDigest(canonicalRenderedForm(rendered)).toString('hex'),
      dedupeKey,
      consentRef: input.consentEvaluation.consentRecordId,
    };
  }

  /**
   * Enqueues already-resolved facts as the worker. Reads no template.
   *
   * Note the handle type: `WorkerDb`, so there is no `RequestContext` to read a
   * tenant from and every scoping value must be named by the caller.
   */
  async enqueuePrepared(
    db: WorkerDb,
    input: EnqueuePreparedInput
  ): Promise<QueuedMessage | null> {
    const inserted = await this.dispatch.enqueuePrepared(db, {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      companyId: input.companyId,
      branchId: input.branchId,
      templateVersionId: input.templateVersionId,
      channel: input.channel,
      purpose: input.purpose,
      recipientUserId: input.recipientUserId,
      bodySha256: Buffer.from(input.bodySha256, 'hex'),
      dedupeKey: input.dedupeKey,
      consentRef: input.consentRef,
      createdBy: input.createdBy,
    });
    if (inserted) return { messageId: inserted.id, deduplicated: false };

    const existing = await this.dispatch.findIdByDedupeKey(db, input.tenantId, input.dedupeKey);
    return existing === null ? null : { messageId: existing, deduplicated: true };
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
          templateStatus: version.template_status,
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
      rendered = renderTemplate({ subject: version.subject, body: version.body }, input.variables, {
        channel,
        maxRenderedChars: config.NOTIFICATION_MAX_RENDERED_CHARS,
      });
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

    // The scope is resolved ONCE and reused by the row, the audit record and the
    // event. It used to be resolved three times: the row fell back to the
    // session's company, the audit and the event did not. A caller that named a
    // branch without naming its company therefore wrote a row with
    // `(company, branch)` and an outbox entry with `(null, branch)` - which
    // `ck_event_outbox_branch_requires_company` refuses, turning a valid
    // branch-scoped enqueue into a fault (PMR-005). Three readings of one fact
    // is the bug; one reading is the fix.
    const scope = {
      companyId: input.companyId ?? context.companyIds[0] ?? null,
      branchId: input.branchId ?? null,
    };

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
      ...scope,
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
      ...scope,
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
      ...scope,
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
