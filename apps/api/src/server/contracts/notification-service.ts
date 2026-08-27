/**
 * Notification service — contract only (P1-13-BE-019).
 *
 * Frozen so Phases 1-15/1-23 implement without a signature change. Three
 * parameters are **mandatory in the type**, which is the point of writing the
 * contract now rather than later:
 *
 *  - `templateVersionId` — messages are sent from an approved, immutable
 *    template version (Phase 1-5 `shared.template_versions`), never from an
 *    ad-hoc string assembled at the call site;
 *  - `locale` — the tenant operates in `ar` and `en`; a message without an
 *    explicit locale silently becomes whatever the default happens to be;
 *  - `dedupeKey` — delivery is retried, so a queue-message call must be
 *    idempotent by construction.
 *
 * `consentEvaluation` is required too: consent is checked at queue time against
 * the CRM consent record, and making it a required argument means a later phase
 * cannot forget it and discover the omission through a complaint.
 *
 * Out of scope in P1-13: provider integration, dispatch, delivery-status
 * ingestion, retry policy, template rendering.
 */
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from '../db/transaction';
import type { WorkerDb } from '../worker/worker-db';

export type NotificationChannel = 'email' | 'sms' | 'whatsapp' | 'in_app';

/** Result of evaluating consent for the recipient and channel. */
export interface ConsentEvaluation {
  /** False means the message must not be queued. */
  readonly granted: boolean;
  /** Consent record consulted, for audit. */
  readonly consentRecordId: string | null;
  readonly evaluatedAt: Date;
}

export interface QueueMessageInput {
  readonly channel: NotificationChannel;
  /** Immutable approved version from `shared.template_versions`. */
  readonly templateVersionId: string;
  /** BCP-47 / `shared.languages.locale_code`, e.g. `ar`, `en`. */
  readonly locale: string;
  /** Idempotency key for the queue attempt. Mandatory. */
  readonly dedupeKey: string;
  /** Recipient reference — a partner/contact id, never a raw address. */
  readonly recipientRef: string;
  /** Template variables. Restricted values are resolved by the sender, not here. */
  readonly variables: Record<string, string>;
  /** Consent decision. Mandatory: no message is queued without one. */
  readonly consentEvaluation: ConsentEvaluation;
  readonly companyId?: string | null;
  readonly branchId?: string | null;
}

export interface QueuedMessage {
  readonly messageId: string;
  /** True when the dedupe key matched an existing queued message. */
  readonly deduplicated: boolean;
}

/**
 * The immutable facts an already-resolved notification consists of.
 *
 * This is what a PUBLISHER computes under `app_runtime` inside the tenant's own
 * context, and what an event may carry to a worker that can resolve none of it.
 * Every field is either an opaque identifier or a digest: there is no rendered
 * body here and no recipient address, because `outbound_messages` stores no body
 * (`message-dispatcher.ts`) and a recipient is an opaque UUID reference, never an
 * address (`assertRecipientReference`).
 *
 * `bodySha256` is hex rather than a Buffer so the shape survives JSON — an event
 * payload is persisted as `jsonb`, and a Buffer would arrive back as an object.
 */
export interface PreparedNotification {
  /** Immutable approved version from `shared.template_versions`. */
  readonly templateVersionId: string;
  /** The channel whose template resolved. Never assumed by the consumer. */
  readonly channel: NotificationChannel;
  /** `transactional | marketing | system` — a TEMPLATE fact, not a caller choice. */
  readonly purpose: string;
  /** The recipient, as a tenant user id. */
  readonly recipientUserId: string;
  /** Hex SHA-256 of the canonical rendered form, computed BEFORE publication. */
  readonly bodySha256: string;
  readonly dedupeKey: string;
  /** Consent RECORD reference. Not a freshness claim — see `prepareNotification`. */
  readonly consentRef: string | null;
}

/**
 * What a publisher knows: WHAT to say and WHO to say it to.
 *
 * There is no `locale` member, deliberately. `shared.outbound_messages` has no
 * locale column — the locale is a property of the TEMPLATE VERSION, so the
 * resolved `templateVersionId` already carries it exactly. A caller choosing one
 * would have to know the tenant's `org.tenants.default_locale`, which belongs to
 * the `iam` module, so every caller outside `iam` would need a new cross-module
 * port to name a value the resolved row already determines. When a tenant has
 * authored several locales for one `(template_code, channel)` the choice is made
 * deterministically by the repository's ORDER BY rather than by this input, and
 * that is a known limitation rather than a selection feature.
 */
export interface PrepareNotificationInput {
  /** Stable identifier of the content. `purpose` classifies, it cannot identify. */
  readonly templateCode: string;
  /**
   * Channels to try, in preference order.
   *
   * The channel is an INPUT to template resolution, not an output of it: the
   * natural key is `(template_code, channel, locale_code)`. Passing an ordered
   * list keeps the choice data-driven rather than hard-coded at the call site.
   */
  readonly channels: readonly NotificationChannel[];
  readonly recipientUserId: string;
  readonly variables: Record<string, string>;
  readonly dedupeKey: string;
  readonly consentEvaluation: ConsentEvaluation;
}

/**
 * A prepared notification plus the scope and authorship a worker cannot supply.
 *
 * The worker holds no tenant context — it drains a cross-tenant queue — so every
 * scoping value is named explicitly rather than read from a session GUC.
 */
export interface EnqueuePreparedInput extends PreparedNotification {
  readonly tenantId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  /** `outbound_messages.created_by` is NOT NULL and the worker policy requires it. */
  readonly createdBy: string;
}

export interface NotificationService {
  queueMessage(db: DbHandle, input: QueueMessageInput): Promise<QueuedMessage>;

  /**
   * Resolves a notification to immutable facts WITHOUT enqueueing it.
   *
   * Runs on the REQUEST side, under `app_runtime` and the tenant's own RLS, so it
   * may read templates and render. It renders only to compute `bodySha256` and
   * then DISCARDS the rendered content — `message-dispatcher.ts` records that
   * rendered content is "never persisted, never logged", and an event payload is
   * persistence.
   *
   * Returns `null` when no offered channel yields a usable, RENDERABLE template.
   * Every one of those is a DATA STATE rather than a failure, and a caller must
   * not fail its own operation because of any of them:
   *
   *  - no template authored at all — the state of every tenant today, since no
   *    message template ships (zero seeds, zero migration inserts);
   *  - the template is disabled, or its version is not approved;
   *  - the authored body cannot be rendered from the variables this caller
   *    supplies. Template bodies are TENANT-AUTHORED and nothing binds a variable
   *    contract to a template code, so a tenant can author a body no publisher
   *    can render. That must never become the publisher's failure.
   *
   * `queueMessage` still THROWS on a render failure, and must: a caller there
   * asked to send one specific message and is entitled to be told it could not be
   * rendered. A publisher only asked whether a message was due.
   *
   * `consentRef` is carried as a durable POINTER to a consent record. It is not a
   * freshness guarantee: `assertConsent` refuses an evaluation older than five
   * minutes on the request path, and queue lag can exceed that, so nothing
   * downstream may read this field as "consent was fresh when the row was
   * written".
   */
  prepareNotification(
    db: DbHandle,
    input: PrepareNotificationInput
  ): Promise<PreparedNotification | null>;

  /**
   * Enqueues an ALREADY-RESOLVED notification. Reads no template, renders nothing.
   *
   * This is the worker's entry point. `app_worker` holds a column-level INSERT on
   * `shared.outbound_messages` that excludes `status`, narrowed by the RESTRICTIVE
   * policy `wkr_outbound_messages_enqueue_scope`, so the only row it can produce
   * is a `pending` one carrying a tenant, an author and a dedupe key.
   *
   * A replay is DEDUPLICATED, not null: when the existing `(tenant_id,
   * dedupe_key)` conflict target already holds a row the implementation reads
   * that row's id back and returns `{ messageId, deduplicated: true }`. `null`
   * means neither an insert nor a lookup produced a row — the conflict fired and
   * the existing row then could not be read — which is a fault, not a replay.
   * The conflict target is the platform's own, reused rather than reinvented.
   *
   * `templateVersionId` is accepted and deliberately NOT persisted: the table's
   * BEFORE INSERT guard reads `shared.template_versions` as the invoker, and the
   * worker holds nothing there. See `message-dispatch-repository.ts`.
   *
   * Takes a `WorkerDb`, NOT a `DbHandle`. That is the type system stating the
   * boundary: a `DbHandle` carries a `RequestContext`, and the worker has none —
   * so a signature that accepted one would suggest this path could read a tenant
   * from the session, which is exactly the assumption that must not be made here.
   */
  enqueuePrepared(db: WorkerDb, input: EnqueuePreparedInput): Promise<QueuedMessage | null>;
}

/** Contract-only stub. */
export class NotImplementedNotificationService implements NotificationService {
  async queueMessage(): Promise<QueuedMessage> {
    throw new AppFailure('ERR-STB-001', {
      message:
        'NotificationService.queueMessage is a P1-13 contract stub; implementation lands in Phase 1-15/1-23',
      safeDetails: { contract: 'NotificationService' },
    });
  }

  async prepareNotification(): Promise<PreparedNotification | null> {
    // Throws rather than returning null. `null` is the contract's way of saying
    // "no usable template", a legitimate data state a caller proceeds past — so a
    // stub returning it would make an unbound service indistinguishable from an
    // unseeded tenant, and the composition-root omission would never surface.
    throw new AppFailure('ERR-STB-001', {
      message: 'NotificationService.prepareNotification has no implementation bound',
      safeDetails: { contract: 'NotificationService' },
    });
  }

  async enqueuePrepared(): Promise<QueuedMessage | null> {
    throw new AppFailure('ERR-STB-001', {
      message: 'NotificationService.enqueuePrepared has no implementation bound',
      safeDetails: { contract: 'NotificationService' },
    });
  }
}

let service: NotificationService = new NotImplementedNotificationService();

export function notificationService(): NotificationService {
  return service;
}

export function setNotificationService(next: NotificationService): void {
  service = next;
}

export function __resetNotificationServiceForTests(): void {
  service = new NotImplementedNotificationService();
}
