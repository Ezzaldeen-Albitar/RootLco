/**
 * Outbound-message and delivery-attempt READS — request runtime (P1-23).
 *
 * Separate from `notification-repository.ts` on purpose. That file is the write
 * path and its whole design rests on how little `app_runtime` may do: SELECT and
 * a policy-pinned INSERT on `shared.outbound_messages`, and **nothing at all**
 * on `shared.delivery_attempts`. This file is the other half — the SELECTs that
 * P1-15 granted and never exposed.
 *
 * Nothing here can mutate anything, and that is structural rather than a
 * convention: `app_runtime` holds no UPDATE on `outbound_messages` and no
 * INSERT/UPDATE/DELETE on `delivery_attempts`, so a bug in this file cannot
 * forge a delivery, advance a lifecycle, or rewrite attempt history. The RLS
 * policies (`sel_outbound_messages_tenant`, `sel_delivery_attempts_tenant`,
 * both `USING (tenant_id = iam.current_tenant_id())`) are the tenant boundary,
 * and every query below *also* carries its own `tenant_id` predicate so the
 * isolation is proven twice — RLS is the backstop, not the only guard.
 *
 * ## What is deliberately not selected
 *
 * `body_sha256` and `recipient_digest` never leave this file. The first is an
 * integrity digest of content that is not persisted at all; the second is a
 * salted digest of an external destination. Neither is useful to a caller and
 * both are exactly the shape of value that ends up in a log by accident.
 * `delivery_attempts.details` is excluded for the same reason — it is the one
 * provider-shaped jsonb column that could carry a raw provider payload.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/**
 * Newest-first by creation, tie-broken by id.
 *
 * `created_at` alone is not a stable key: two messages enqueued in one
 * transaction share a timestamp, and a cursor built on a non-unique column
 * silently skips or repeats rows across pages. The id is what makes the keyset
 * total, which is why `keysetFragment` takes both columns rather than one.
 */
export const NOTIFICATION_ORDERING: OrderingContract = {
  key: 'shared.outbound_messages:created_at_desc',
  direction: 'desc',
};

export interface NotificationRow {
  readonly id: string;
  readonly channel: string;
  readonly purpose: string;
  readonly status: string;
  readonly template_version_id: string | null;
  readonly recipient_user_id: string | null;
  readonly retry_count: number;
  readonly failure_class: string | null;
  readonly company_id: string | null;
  readonly branch_id: string | null;
  readonly record_version: number;
  readonly created_at: Date;
  readonly queued_at: Date | null;
  readonly sent_at: Date | null;
  readonly delivered_at: Date | null;
  readonly failed_at: Date | null;
  readonly cancelled_at: Date | null;
}

export interface DeliveryAttemptRow {
  readonly id: string;
  readonly message_id: string;
  readonly attempt_number: number;
  readonly provider_code: string;
  readonly provider_message_ref: string | null;
  readonly status: string;
  readonly response_code: string | null;
  readonly error_summary: string | null;
  readonly attempted_at: Date;
  readonly completed_at: Date | null;
}

/** The columns a caller may see. `body_sha256`/`recipient_digest` are absent by design. */
const MESSAGE_COLUMNS = `
  id, channel, purpose, status, template_version_id, recipient_user_id,
  retry_count, failure_class, company_id, branch_id, record_version,
  created_at, queued_at, sent_at, delivered_at, failed_at, cancelled_at
`;

export class NotificationReadRepository extends Repository {
  protected readonly module = 'shared-services';

  /**
   * Lists messages addressed to one in-product user.
   *
   * `recipient_user_id = $2` is not a convenience filter — it is the whole
   * visibility rule for the in-app inbox, applied in SQL rather than after the
   * fact so a caller can never read another user's queue by paging past their
   * own. A message whose recipient is a digest (an external address) has
   * `recipient_user_id IS NULL` and is therefore invisible here, which is
   * correct: there is no in-product user to show it to.
   */
  async listForRecipient(
    db: DbHandle,
    recipientUserId: string,
    request: PageRequest
  ): Promise<Page<NotificationRow>> {
    const context = this.assertContext(db);
    const keyset = keysetFragment(
      request,
      { sort: 'created_at', id: 'id' },
      NOTIFICATION_ORDERING,
      3
    );
    const result = await this.run<NotificationRow>(
      db,
      `SELECT ${MESSAGE_COLUMNS}
         FROM shared.outbound_messages
        WHERE tenant_id = $1
          AND recipient_user_id = $2
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [context.principal.tenantId, recipientUserId, ...keyset.values]
    );
    return buildPage(result.rows, request, NOTIFICATION_ORDERING, (row) => ({
      sortValue: row.created_at.toISOString(),
      id: row.id,
    }));
  }

  /**
   * Reads one message the given user is the recipient of.
   *
   * Both predicates are mandatory. Dropping `recipient_user_id` would turn this
   * into an IDOR that RLS cannot catch, because RLS proves the row belongs to
   * the *tenant* and says nothing about which user inside it may see it.
   */
  async findForRecipient(
    db: DbHandle,
    id: string,
    recipientUserId: string
  ): Promise<NotificationRow | null> {
    const context = this.assertContext(db);
    return this.runOne<NotificationRow>(
      db,
      `SELECT ${MESSAGE_COLUMNS}
         FROM shared.outbound_messages
        WHERE tenant_id = $1 AND id = $2 AND recipient_user_id = $3`,
      [context.principal.tenantId, id, recipientUserId]
    );
  }

  /**
   * Reads one message for privileged delivery inspection, without the recipient
   * restriction.
   *
   * This answers a different question from the inbox: "may this actor inspect
   * delivery of any message in the tenant". The caller must have authorized that
   * separately — the service does, and the audit record it writes is what makes
   * the wider visibility accountable.
   */
  async findForInspection(db: DbHandle, id: string): Promise<NotificationRow | null> {
    const context = this.assertContext(db);
    return this.runOne<NotificationRow>(
      db,
      `SELECT ${MESSAGE_COLUMNS}
         FROM shared.outbound_messages
        WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, id]
    );
  }

  /**
   * Lists the append-only attempt history for one message, oldest attempt first.
   *
   * Ascending by `attempt_number` because that is the story an operator reads:
   * attempt 1 errored, attempt 2 accepted. The column is unique per message
   * (`uq_delivery_attempts_message_number`), so it is already a total order and
   * needs no tie-break.
   */
  async listAttempts(db: DbHandle, messageId: string): Promise<readonly DeliveryAttemptRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<DeliveryAttemptRow>(
      db,
      `SELECT id, message_id, attempt_number, provider_code, provider_message_ref,
              status, response_code, error_summary, attempted_at, completed_at
         FROM shared.delivery_attempts
        WHERE tenant_id = $1 AND message_id = $2
        ORDER BY attempt_number ASC`,
      [context.principal.tenantId, messageId]
    );
    return result.rows;
  }
}
