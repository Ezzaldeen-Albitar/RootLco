/**
 * Outbound-message data access — worker archetype (P1-15).
 *
 * Runs on `app_worker`, whose policies on `shared.outbound_messages` and
 * `shared.delivery_attempts` are `USING (true)`: a dispatcher must see every
 * tenant's queue. There is therefore **no `RequestContext` and no
 * `iam.current_tenant_id()`** here, exactly as `server/worker/worker-db.ts`
 * establishes — the tenant of each row is read *from the row* and then carried
 * explicitly into every write.
 *
 * ## What `app_worker` can and cannot reach, verified against the catalog
 *
 * | Relation                     | `app_worker` may                          |
 * | ---------------------------- | ----------------------------------------- |
 * | `shared.outbound_messages`   | SELECT · UPDATE(status, failure_class) · INSERT(13 cols, NOT `status`) |
 * | `shared.delivery_attempts`   | SELECT · INSERT(…)                        |
 * | `shared.message_templates`   | **nothing at all**                        |
 * | `shared.template_versions`   | **nothing at all**                        |
 *
 * The INSERT is new (migration `20260827090000`) and is narrower than it looks:
 * it is a COLUMN-level grant that excludes `status`, so `'pending'` — the column
 * default — is the only state this role can produce, and the RESTRICTIVE policy
 * `wkr_outbound_messages_enqueue_scope` pins that a second time along with a
 * non-null tenant, author and dedupe key. It exists so an event consumer can
 * enqueue; it does not let the worker author a message of its own devising,
 * because every fact it writes must be carried to it.
 *
 * That last row is not an oversight to work around — it is the design, and it
 * settles how content flows. The worker **cannot read a template body**, and
 * `outbound_messages` stores no body (its `body_sha256` column is documented as
 * "integrity digest of rendered content that is not persisted here"). So the
 * rendered content is produced once, at enqueue, and handed to the dispatcher
 * in-process; the dispatcher verifies it against the stored digest before
 * contacting a provider.
 *
 * **Residual risk, recorded rather than hidden:** because no durable transient
 * content store is provisioned, a message whose rendered content is lost from
 * process memory cannot be re-rendered by another process. The durable row still
 * records that the message was requested, its integrity digest, and its delivery
 * lifecycle — but cross-process redelivery of *content* is not implemented and
 * is not claimed. See the P1-15 open decisions record.
 *
 * Timestamps and `retry_count` are never written from here: every one of them is
 * assigned by `shared.guard_outbound_message_lifecycle()`, which rejects a
 * statement that tries to set them. The UPDATEs below therefore change `status`
 * (and `failure_class` where the guard demands it) and nothing else.
 */
import type { WorkerDb } from '@/server/worker/worker-db';

export interface DispatchCandidate {
  readonly id: string;
  readonly tenant_id: string;
  readonly channel: string;
  readonly purpose: string;
  readonly status: string;
  readonly retry_count: number;
  readonly body_sha256: Buffer;
  readonly recipient_user_id: string | null;
  readonly template_version_id: string | null;
}

/** Lifecycle edges `guard_outbound_message_lifecycle()` accepts. */
export const DISPATCH_TRANSITIONS = {
  queue: { from: 'pending', to: 'queued' },
  start: { from: 'queued', to: 'sending' },
  sent: { from: 'sending', to: 'sent' },
  delivered: { from: 'sent', to: 'delivered' },
  failFromSending: { from: 'sending', to: 'failed' },
  failFromSent: { from: 'sent', to: 'failed' },
  retry: { from: 'failed', to: 'queued' },
  deadLetter: { from: 'failed', to: 'cancelled' },
} as const;

export class MessageDispatchRepository {
  /**
   * Claims messages to work on.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes two dispatcher processes safe: a row
   * another worker already holds is skipped rather than waited for, so
   * concurrency scales and no message is claimed twice. The ordering by
   * `created_at` keeps the queue roughly fair.
   */
  async claim(db: WorkerDb, status: string, limit: number): Promise<readonly DispatchCandidate[]> {
    const result = await db.query<DispatchCandidate>(
      `SELECT id, tenant_id, channel, purpose, status, retry_count, body_sha256,
              recipient_user_id, template_version_id
         FROM shared.outbound_messages
        WHERE status = $1
        ORDER BY created_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [status, limit]
    );
    return result.rows;
  }

  async find(db: WorkerDb, tenantId: string, messageId: string): Promise<DispatchCandidate | null> {
    const result = await db.query<DispatchCandidate>(
      `SELECT id, tenant_id, channel, purpose, status, retry_count, body_sha256,
              recipient_user_id, template_version_id
         FROM shared.outbound_messages
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, messageId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Moves a message along the lifecycle. Returns the affected row count.
   *
   * The `status = $from` predicate is the concurrency control: two dispatchers
   * that both believe a message is `queued` cannot both move it to `sending`,
   * because the second matches zero rows.
   */
  async transition(
    db: WorkerDb,
    input: {
      readonly tenantId: string;
      readonly messageId: string;
      readonly from: string;
      readonly to: string;
      readonly failureClass?: string | null;
    }
  ): Promise<number> {
    const setsFailureClass = input.to === 'failed' || input.to === 'cancelled';
    const result = await db.query(
      setsFailureClass
        ? `UPDATE shared.outbound_messages
              SET status = $4, failure_class = $5
            WHERE tenant_id = $1 AND id = $2 AND status = $3`
        : `UPDATE shared.outbound_messages
              SET status = $4
            WHERE tenant_id = $1 AND id = $2 AND status = $3`,
      setsFailureClass
        ? [input.tenantId, input.messageId, input.from, input.to, input.failureClass ?? null]
        : [input.tenantId, input.messageId, input.from, input.to]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Clears `failure_class` while retrying.
   *
   * The lifecycle guard nulls it itself on `failed → queued`; this method exists
   * because the column is in the UPDATE grant and the SET list must mention it
   * for the guard's own assignment to be reachable in a single statement.
   */
  async retry(db: WorkerDb, tenantId: string, messageId: string): Promise<number> {
    const result = await db.query(
      `UPDATE shared.outbound_messages
          SET status = 'queued', failure_class = NULL
        WHERE tenant_id = $1 AND id = $2 AND status = 'failed'`,
      [tenantId, messageId]
    );
    return result.rowCount ?? 0;
  }

  async nextAttemptNumber(db: WorkerDb, tenantId: string, messageId: string): Promise<number> {
    const result = await db.query<{ next: string }>(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next
         FROM shared.delivery_attempts
        WHERE tenant_id = $1 AND message_id = $2`,
      [tenantId, messageId]
    );
    return Number(result.rows[0]?.next ?? 1);
  }

  /**
   * Appends a delivery attempt.
   *
   * `error_summary` is required for an errored attempt and forbidden otherwise
   * (`ck_delivery_attempts_error_only_errored`). It is a **sanitised** summary:
   * the caller must never pass a raw provider payload, a stack trace, or a
   * response body, and the column comment says as much.
   */
  async recordAttempt(
    db: WorkerDb,
    input: {
      readonly tenantId: string;
      readonly messageId: string;
      readonly attemptNumber: number;
      readonly providerCode: string;
      readonly status: 'started' | 'accepted' | 'delivered' | 'errored';
      readonly providerMessageRef?: string | null;
      readonly responseCode?: string | null;
      readonly errorSummary?: string | null;
      readonly details?: Record<string, unknown>;
    }
  ): Promise<string | null> {
    const completed = input.status !== 'started';
    const result = await db.query<{ id: string }>(
      `INSERT INTO shared.delivery_attempts
         (tenant_id, message_id, attempt_number, provider_code, provider_message_ref,
          status, response_code, error_summary, details, completed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
               CASE WHEN $10::boolean THEN now() ELSE NULL END, $11)
       RETURNING id`,
      [
        input.tenantId,
        input.messageId,
        input.attemptNumber,
        input.providerCode,
        input.providerMessageRef ?? null,
        input.status,
        input.responseCode ?? null,
        input.errorSummary ?? null,
        JSON.stringify(input.details ?? {}),
        completed,
        SYSTEM_ACTOR,
      ]
    );
    return result.rows[0]?.id ?? null;
  }

  async attempts(
    db: WorkerDb,
    tenantId: string,
    messageId: string
  ): Promise<readonly { attempt_number: number; status: string; provider_code: string }[]> {
    const result = await db.query<{
      attempt_number: number;
      status: string;
      provider_code: string;
    }>(
      `SELECT attempt_number, status, provider_code
         FROM shared.delivery_attempts
        WHERE tenant_id = $1 AND message_id = $2
        ORDER BY attempt_number`,
      [tenantId, messageId]
    );
    return result.rows;
  }

  /**
   * Enqueues an already-resolved notification, as the worker.
   *
   * Every scoping value is a PARAMETER, not a session GUC: this role drains a
   * cross-tenant queue and has no `iam.current_tenant_id()` to read, so the
   * tenant of the row comes from the event that caused it.
   *
   * `status` is not named, and could not be: it is outside the column grant, so
   * the default `'pending'` is the only state this statement can produce. Naming
   * it — even as `'pending'` — would be refused at the privilege layer with
   * `permission denied for table`, which is asserted in the backend suite.
   *
   * `ON CONFLICT (tenant_id, dedupe_key) DO NOTHING` is the platform's EXISTING
   * conflict target, reused rather than reinvented. A redelivered event therefore
   * produces no second message even before `shared.processed_events` is consulted,
   * so the two idempotency mechanisms agree instead of competing.
   *
   * Returns the inserted row, or `null` when the key was already present — the
   * caller then reads the existing id and reports a DEDUPLICATED enqueue.
   *
   * ## `template_version_id` is NOT written, and a declarative fix was tried
   *
   * The BEFORE INSERT guard `shared.guard_outbound_message_scope()` is SECURITY
   * INVOKER and reads `shared.template_versions` whenever the column is set, so a
   * role with no SELECT there cannot name a template version. Measured:
   * `permission denied for table template_versions`.
   *
   * A tenant-qualified composite foreign key — the shape this table's company,
   * branch and recipient keys already use — was built and measured against the
   * live database, because referential-integrity checks run with the CONSTRAINT's
   * rights rather than the caller's and would therefore need no grant. It was
   * withdrawn, for two reasons that are worth recording so it is not retried
   * blindly:
   *
   *  1. It does not remove the read. The guard draws THREE conclusions from one
   *     lookup, and only two of them — existence and tenancy — are expressible as
   *     a key. The third is `status = 'approved'`, and `status` is MUTABLE: a
   *     partial unique index cannot be a foreign-key target, and folding the
   *     status into the referenced key would make the FK refuse the UPDATE that
   *     retires any version a message was ever sent from. After the migration was
   *     applied, all four worker cases still failed with the same permission
   *     error.
   *  2. `template_versions.tenant_id` is NULLABLE — that is how a PLATFORM version
   *     is represented — so the key has to be built on a folded
   *     `COALESCE(tenant_id, sentinel)`, and the referencing row must then DECLARE
   *     which owner it means. That makes a new column mandatory on every writer of
   *     `template_version_id`: applying it failed all 62 cases of
   *     `tests/db/p1-15-notifications.test.ts` on the pairing CHECK alone.
   *
   * So the column stays NULL on worker-enqueued rows. The remaining escapes are
   * closed by standing decisions — a worker SELECT on the template tables is what
   * payload-carries-the-facts forbids, and a SECURITY DEFINER guard is prohibited
   * by two CI gates — which leaves ONE open question for the Owner: whether the
   * `approved` check may move to the publisher, which already enforces it through
   * `assertTemplateUsable`. That is a security-posture decision, not an
   * implementation detail, and it is not taken here.
   */
  async enqueuePrepared(
    db: WorkerDb,
    input: {
      readonly id: string;
      readonly tenantId: string;
      readonly companyId: string | null;
      readonly branchId: string | null;
      readonly templateVersionId: string;
      readonly approvalWitnessId: string;
      readonly templateOwnerTenantId: string;
      readonly channel: string;
      readonly purpose: string;
      readonly recipientUserId: string;
      readonly bodySha256: Buffer;
      readonly dedupeKey: string;
      readonly consentRef: string | null;
      readonly createdBy: string;
    }
  ): Promise<{ id: string } | null> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO shared.outbound_messages
         (id, tenant_id, company_id, branch_id, template_version_id,
          approval_witness_id, template_owner_tenant_id, channel, purpose,
          recipient_user_id, body_sha256, dedupe_key, consent_ref, created_by)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::uuid, $11, $12, $13, $14)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [
        input.id,
        input.tenantId,
        input.companyId,
        input.branchId,
        input.templateVersionId,
        input.approvalWitnessId,
        input.templateOwnerTenantId,
        input.channel,
        input.purpose,
        input.recipientUserId,
        input.bodySha256,
        input.dedupeKey,
        input.consentRef,
        input.createdBy,
      ]
    );
    return result.rows[0] ?? null;
  }

  /** The id an existing dedupe key already holds, so a replay can name the row. */
  async findIdByDedupeKey(
    db: WorkerDb,
    tenantId: string,
    dedupeKey: string
  ): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM shared.outbound_messages WHERE tenant_id = $1 AND dedupe_key = $2`,
      [tenantId, dedupeKey]
    );
    return result.rows[0]?.id ?? null;
  }
}

/**
 * Actor recorded on worker-written rows.
 *
 * Re-declared rather than imported from `worker-db.ts` so this repository does
 * not depend on the pool module for a constant; both spellings are asserted
 * equal by `tests/backend/p1-15-dispatch-and-health.test.ts`.
 */
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
