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

export interface NotificationService {
  queueMessage(db: DbHandle, input: QueueMessageInput): Promise<QueuedMessage>;
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
