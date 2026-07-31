/**
 * Notification read surface (P1-23).
 *
 * P1-15 built the write half — enqueue a `pending` message — and granted the
 * runtime SELECT on both `shared.outbound_messages` and
 * `shared.delivery_attempts` without ever exposing them. This service is the
 * read half, and it draws one line the schema cannot draw for itself:
 *
 *   * the **inbox** is scoped to the caller. `recipient_user_id` is a SQL
 *     predicate, not a filter applied to a wider result, because RLS proves the
 *     row belongs to the tenant and says nothing about which user inside it may
 *     see it. Without that predicate this is an IDOR that every isolation test
 *     would still pass.
 *   * **delivery inspection** is deliberately wider — an operator diagnosing a
 *     stuck queue must see messages they did not receive — so it takes a
 *     different permission and is audited. Wider visibility that is not
 *     accountable is just a leak with a permission attached.
 *
 * ## Delivery state is reported, never inferred
 *
 * The frozen contract distinguishes `accepted` (the provider took the message)
 * from `delivered` (the provider gave evidence it arrived), and this service
 * reports whichever the row holds. Collapsing them would be the single most
 * tempting lie in the whole phase, and it would contradict the schema rather
 * than merely a policy: `ck_delivery_attempts_status` enumerates both.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import type { NotificationReadRepository } from '../data/notification-read-repository';
import {
  NOTIFICATION_ORDERING,
  type DeliveryAttemptRow,
  type NotificationRow,
} from '../data/notification-read-repository';

/** A message as a recipient or operator may see it. No digest, no body, no address. */
export interface NotificationView {
  readonly notificationId: string;
  readonly channel: string;
  readonly purpose: string;
  readonly status: string;
  readonly templateVersionId: string | null;
  readonly retryCount: number;
  /** Present only on a failed message; a safe classification, never a provider string. */
  readonly failureClass: string | null;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly recordVersion: number;
  readonly createdAt: string;
  readonly queuedAt: string | null;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly failedAt: string | null;
  readonly cancelledAt: string | null;
}

/** One append-only attempt. `details` is not surfaced — see the repository. */
export interface DeliveryAttemptView {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly providerCode: string;
  readonly providerMessageRef: string | null;
  readonly status: string;
  readonly responseCode: string | null;
  readonly errorSummary: string | null;
  readonly attemptedAt: string;
  readonly completedAt: string | null;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const toNotificationView = (row: NotificationRow): NotificationView => ({
  notificationId: row.id,
  channel: row.channel,
  purpose: row.purpose,
  status: row.status,
  templateVersionId: row.template_version_id,
  retryCount: row.retry_count,
  failureClass: row.failure_class,
  companyId: row.company_id,
  branchId: row.branch_id,
  recordVersion: row.record_version,
  createdAt: row.created_at.toISOString(),
  queuedAt: iso(row.queued_at),
  sentAt: iso(row.sent_at),
  deliveredAt: iso(row.delivered_at),
  failedAt: iso(row.failed_at),
  cancelledAt: iso(row.cancelled_at),
});

const toAttemptView = (row: DeliveryAttemptRow): DeliveryAttemptView => ({
  attemptId: row.id,
  attemptNumber: row.attempt_number,
  providerCode: row.provider_code,
  providerMessageRef: row.provider_message_ref,
  status: row.status,
  responseCode: row.response_code,
  errorSummary: row.error_summary,
  attemptedAt: row.attempted_at.toISOString(),
  completedAt: iso(row.completed_at),
});

export class NotificationReadService extends ApplicationService {
  protected readonly module = 'shared-services';

  constructor(private readonly repository: NotificationReadRepository) {
    super();
  }

  /**
   * The caller's own in-app inbox.
   *
   * The recipient is taken from the request context and never from input.
   * Accepting a `recipientUserId` parameter here — even an optional one — is the
   * whole vulnerability, because any caller could then read any inbox in the
   * tenant and every tenant-isolation test would still pass.
   */
  async listMine(
    db: DbHandle,
    query: { readonly limit?: number | undefined; readonly cursor?: string | undefined }
  ): Promise<Page<NotificationView>> {
    const context = this.contextOf(db);
    const page = await this.repository.listForRecipient(
      db,
      context.principal.userId,
      pageRequest(NOTIFICATION_ORDERING, query)
    );
    return { ...page, items: page.items.map(toNotificationView) };
  }

  /** One notification from the caller's own inbox, or `ERR-NTF-001` if it is not theirs. */
  async readMine(db: DbHandle, notificationId: string): Promise<NotificationView> {
    const context = this.contextOf(db);
    const row = await this.repository.findForRecipient(
      db,
      notificationId,
      context.principal.userId
    );
    if (row === null) {
      // Deliberately indistinguishable from "does not exist": a caller must not
      // be able to probe which notification ids are real in this tenant.
      throw new AppFailure('ERR-NTF-001', {
        // No `safeDetails`: the id the caller already sent adds nothing, and
        // `SafeDetails` is a closed shape precisely so identifiers cannot drift
        // into error bodies.
        message: 'Notification not found.',
      });
    }
    return toNotificationView(row);
  }

  /**
   * The delivery history of one message, for privileged inspection.
   *
   * Returns the message alongside its attempts so an operator sees the lifecycle
   * and the evidence together — a `failed` message with three `errored` attempts
   * is a different problem from a `sent` message with none.
   */
  async readDeliveries(
    db: DbHandle,
    notificationId: string
  ): Promise<{
    readonly notification: NotificationView;
    readonly attempts: readonly DeliveryAttemptView[];
  }> {
    const row = await this.repository.findForInspection(db, notificationId);
    if (row === null) {
      throw new AppFailure('ERR-NTF-001', {
        // No `safeDetails`: the id the caller already sent adds nothing, and
        // `SafeDetails` is a closed shape precisely so identifiers cannot drift
        // into error bodies.
        message: 'Notification not found.',
      });
    }
    const attempts = await this.repository.listAttempts(db, notificationId);

    // The audit is written HERE, in the same transaction as the read, because
    // the wider-than-inbox visibility is the thing being made accountable. A
    // record written after the response would be a record of an intention.
    //
    // The recipient is audited as a USER REFERENCE, never as an address: the
    // row's other recipient column is a salted digest and neither belongs in an
    // audit trail.
    await appendAudit(db, {
      action: 'shared.notification.delivery_inspected',
      entityType: 'shared.outbound_message',
      entityId: notificationId,
      companyId: row.company_id,
      branchId: row.branch_id,
      details: [
        { field: 'message_status', classification: 'internal', value: row.status },
        { field: 'attempt_count', classification: 'internal', value: String(attempts.length) },
        {
          field: 'inspected_own_message',
          classification: 'internal',
          value: String(row.recipient_user_id === this.contextOf(db).principal.userId),
        },
      ],
    });
    return {
      notification: toNotificationView(row),
      attempts: attempts.map(toAttemptView),
    };
  }
}
