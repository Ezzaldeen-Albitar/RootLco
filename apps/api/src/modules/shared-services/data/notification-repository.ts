/**
 * Outbound-message data access — request runtime (P1-15).
 *
 * `app_runtime` may **only** SELECT and INSERT `shared.outbound_messages`, and
 * the INSERT policy pins `status = 'pending'` and requires
 * `shared.notification.send` in scope. It holds **nothing** on
 * `shared.delivery_attempts`, and no UPDATE on the message itself. That is the
 * separation the whole design rests on: a request can *ask* for a message to be
 * sent, and cannot claim it was sent, cannot forge a delivery attempt, and
 * cannot mark it delivered. Those are `app_worker`'s, in a different process on
 * a different role — see `message-dispatch-repository.ts`.
 *
 * The row stores **no content and no address**: `body_sha256` is an integrity
 * digest of content that is not persisted (the column's own comment says so),
 * and the recipient is either a tenant-bound user id or a salted digest.
 */
import { Repository, isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface OutboundMessageRow {
  readonly id: string;
  readonly channel: string;
  readonly purpose: string;
  readonly status: string;
  readonly template_version_id: string | null;
  readonly recipient_user_id: string | null;
  readonly dedupe_key: string;
  readonly retry_count: number;
  readonly failure_class: string | null;
  readonly company_id: string | null;
  readonly branch_id: string | null;
  readonly record_version: number;
}

export interface EnqueueResult {
  readonly messageId: string;
  /** True when `uq_outbound_messages_dedupe` matched an existing message. */
  readonly deduplicated: boolean;
}

export class NotificationRepository extends Repository {
  protected readonly module = 'shared-services';

  /**
   * Inserts a pending message, or resolves the existing one for the dedupe key.
   *
   * `ON CONFLICT DO NOTHING` plus a follow-up read rather than
   * `ON CONFLICT DO UPDATE`: the existing row must not be touched at all. It may
   * already be `sending`, and any UPDATE would both need a grant the runtime
   * does not have and risk resetting a lifecycle the worker owns.
   */
  async enqueue(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly channel: string;
      readonly purpose: string;
      readonly templateVersionId: string;
      readonly recipientUserId: string | null;
      readonly recipientDigest: Buffer | null;
      readonly bodySha256: Buffer;
      readonly dedupeKey: string;
      readonly consentRef: string | null;
      readonly companyId: string | null;
      readonly branchId: string | null;
    }
  ): Promise<EnqueueResult | null> {
    const context = this.assertContext(db);
    const inserted = await this.runOne<{ id: string }>(
      db,
      `INSERT INTO shared.outbound_messages
         (id, tenant_id, company_id, branch_id, template_version_id, channel, purpose,
          recipient_digest, recipient_user_id, body_sha256, dedupe_key, consent_ref, created_by)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid, $10, $11, $12, $13)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [
        input.id,
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.templateVersionId,
        input.channel,
        input.purpose,
        input.recipientDigest,
        input.recipientUserId,
        input.bodySha256,
        input.dedupeKey,
        input.consentRef,
        context.principal.userId,
      ]
    );
    if (inserted) return { messageId: inserted.id, deduplicated: false };

    const existing = await this.findByDedupeKey(db, input.dedupeKey);
    return existing ? { messageId: existing.id, deduplicated: true } : null;
  }

  async findByDedupeKey(db: DbHandle, dedupeKey: string): Promise<OutboundMessageRow | null> {
    const context = this.assertContext(db);
    return this.runOne<OutboundMessageRow>(
      db,
      `SELECT id, channel, purpose, status, template_version_id, recipient_user_id,
              dedupe_key, retry_count, failure_class, company_id, branch_id, record_version
         FROM shared.outbound_messages
        WHERE tenant_id = $1 AND dedupe_key = $2`,
      [context.principal.tenantId, dedupeKey]
    );
  }

  async findMessage(db: DbHandle, messageId: string): Promise<OutboundMessageRow | null> {
    const context = this.assertContext(db);
    return this.runOne<OutboundMessageRow>(
      db,
      `SELECT id, channel, purpose, status, template_version_id, recipient_user_id,
              dedupe_key, retry_count, failure_class, company_id, branch_id, record_version
         FROM shared.outbound_messages
        WHERE tenant_id = $1 AND id = $2`,
      [context.principal.tenantId, messageId]
    );
  }

  /** True when the reference names an active user account in the caller's tenant. */
  async isTenantUser(db: DbHandle, userId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT true AS ok FROM iam.user_accounts
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, userId]
    );
    return row !== null;
  }

  /**
   * Confirms that the request runtime cannot write a delivery attempt.
   *
   * Used by the security suite, not by the enqueue path. It is a *method* rather
   * than a test-local statement so the claim "request runtime cannot forge
   * delivery evidence" is exercised through the same repository layer the
   * application uses, instead of through a hand-written query that could differ.
   */
  async attemptForgeDeliveryAttempt(db: DbHandle, messageId: string): Promise<void> {
    const context = this.assertContext(db);
    await this.run(
      db,
      `INSERT INTO shared.delivery_attempts
         (tenant_id, message_id, attempt_number, provider_code, status, completed_at, created_by)
       VALUES ($1, $2, 1, 'forged', 'delivered', now(), $3)`,
      [context.principal.tenantId, messageId, context.principal.userId]
    );
  }

  /** True when `error` is the dedupe-key unique violation. */
  static isDedupeConflict(error: unknown): boolean {
    return isSqlState(error, SQLSTATE.uniqueViolation);
  }
}
