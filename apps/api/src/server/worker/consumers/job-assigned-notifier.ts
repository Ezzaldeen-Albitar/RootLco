/**
 * `job.assigned` v2 → one notification for the assigned technician (PRE-P1-29-BR-09).
 *
 * Closes `BE-6`, `DEP-B6`, finding `INS-25` (**BLOCKER**) and Owner requirement 6.
 *
 * ## What was wrong
 *
 * Assigning a technician notified nobody. `consumersFor('job.assigned')` returned an
 * empty set, so the worker completed the event having done nothing — which is why
 * `DEP-B6`'s general shape ("notifications are enqueue-on-request only, and no
 * domain event raises one") was true of every event, not just this one.
 *
 * ## This consumer resolves NOTHING, and that is the design
 *
 * An earlier version of this file read `wo.job_assignments`, `tech.technician_profiles`,
 * `wo.jobs` and `shared.message_templates`. It could never have run: `app_worker`
 * has USAGE on neither `wo` nor `tech` and no privilege at all on the template
 * tables. Those reads are not a gap awaiting a grant — they are the boundary.
 *
 * So every fact arrives on the event, resolved at publish time by `app_runtime`
 * inside the tenant's own RLS. This file reads the envelope and the payload, and
 * nothing else. It does not even read the approval witness: the database validates
 * the carried witness through `fk_outbound_messages_approval_witness` when the row
 * is inserted, which is a stronger check than a lookup here could make.
 *
 * ## Inherited, never re-implemented
 *
 *   idempotency   `shared.processed_events` keyed (consumer_code, event_id), written
 *                 by `runConsumer()` in the same transaction as the effect
 *   retry         the outbox worker's full-jitter backoff
 *   dead letter   a STATUS on `shared.event_outbox`, moved by the worker after the
 *                 attempt ceiling. There is no dead-letter TABLE and this file
 *                 references none.
 *   dedupe        the platform's `(tenant_id, dedupe_key)` conflict target
 *
 * A second dedupe mechanism here would drift from `processed_events`, and the drift
 * would only ever be discovered as a double notification.
 *
 * ## The consumer code is a KEY, not a label
 *
 * `ck_processed_events_consumer_code_format` is `^[a-z][a-z0-9_.]{1,62}$` — no
 * hyphen — so the contract's `wo.job-assigned-notifier` could never have been
 * written. It is half of a primary key, so renaming it later would make every
 * historical event look unprocessed and re-deliver the lot.
 */
import {
  registerConsumer,
  type ConsumedEvent,
  type Consumer,
  type ConsumerOutcome,
} from '../consumer-registry';
import type { WorkerDb } from '../worker-db';
import { log } from '@/server/observability/logger';
// The FOUNDATION CONTRACT, never `@/modules/shared-services`: `server/` is the API
// foundation and boundary rule B3 refuses a foundation file that imports a domain
// module. This seam exists for exactly this dependency.
import { notificationService } from '@/server/contracts/notification-service';
import type { NotificationChannel } from '@/server/contracts/notification-service';

/** Half of a primary key. Renaming re-delivers every historical event. */
export const JOB_ASSIGNED_NOTIFIER = 'wo.job_assigned_notifier';

/**
 * The v2 fields this consumer reads.
 *
 * `notification` is OPTIONAL by contract: no message template ships with this
 * platform, so an event without it is the ordinary case on every tenant today
 * rather than a fault.
 */
export const CONSUMED_PAYLOAD_FIELDS: readonly string[] = Object.freeze([
  'jobId',
  'assignmentId',
  'notification',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** A payload this consumer cannot read is a POISON message, not a lookup. */
export class PoisonPayloadError extends Error {
  public override readonly name = 'PoisonPayloadError';
}

interface CarriedNotification {
  readonly templateVersionId: string;
  readonly approvalWitnessId: string;
  readonly templateOwnerTenantId: string;
  readonly channel: NotificationChannel;
  readonly purpose: string;
  readonly recipientUserId: string;
  readonly bodySha256: string;
  readonly dedupeKey: string;
  readonly consentRef: string | null;
}

/**
 * Reads the carried facts, or `null` when the publisher decided none were due.
 *
 * The distinction is why the publisher OMITS the block rather than null-filling it.
 * Absent means "nothing to send" — a legitimate outcome. Present-but-malformed
 * means a publisher contract change nobody noticed, which is poison rather than a
 * no-op, and a best-effort parse would turn it into a silently wrong notification.
 */
function readNotification(event: ConsumedEvent): CarriedNotification | null {
  const raw = event.payload['notification'];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    throw new PoisonPayloadError(`job.assigned notification is not an object (event ${event.id})`);
  }
  const n = raw as Record<string, unknown>;
  const str = (key: string, pattern?: RegExp): string => {
    const value = n[key];
    if (typeof value !== 'string' || (pattern !== undefined && !pattern.test(value))) {
      throw new PoisonPayloadError(
        `job.assigned notification has no readable ${key} (event ${event.id})`
      );
    }
    return value;
  };
  const consentRef = n['consentRef'];
  if (consentRef !== null && typeof consentRef !== 'string') {
    throw new PoisonPayloadError(
      `job.assigned consentRef is neither null nor a string (event ${event.id})`
    );
  }
  return {
    templateVersionId: str('templateVersionId', UUID),
    approvalWitnessId: str('approvalWitnessId', UUID),
    templateOwnerTenantId: str('templateOwnerTenantId', UUID),
    channel: str('channel') as NotificationChannel,
    purpose: str('purpose'),
    recipientUserId: str('recipientUserId', UUID),
    bodySha256: str('bodySha256', SHA256_HEX),
    dedupeKey: str('dedupeKey'),
    consentRef: (consentRef as string | null) ?? null,
  };
}

/**
 * Registers the consumer. Explicit, at worker boot — never an import side effect,
 * so it neither depends on import order nor becomes unrestorable after
 * `__resetConsumersForTests()`.
 */
export function registerJobAssignedNotifier(): Consumer {
  return registerConsumer({
    code: JOB_ASSIGNED_NOTIFIER,
    handles: ['job.assigned'],
    /*
     * TWO only, and there is no v1 implementation to offer.
     *
     * v1 carried `{jobId, assignmentId, assignmentRole}` and left every
     * notification fact to be resolved from `wo`, `tech` and the template tables —
     * reads this role cannot make. An honest v1 handler would therefore be a code
     * path that must always fail, so the registry refuses the version instead and
     * the worker treats it as poison.
     */
    supportedSchemaVersions: [2],
    handle: async (event: ConsumedEvent, db: WorkerDb): Promise<ConsumerOutcome> => {
      const facts = readNotification(event);

      if (facts === null) {
        // COMPLETED, NOT DELIVERED. No message template ships, so a tenant that has
        // authored none reaches here on the ordinary path. Throwing would burn the
        // attempt ceiling on an answer determined correctly on the first try.
        log.info('job.assigned carried no notification; nothing to enqueue', {
          module: 'outbox-worker',
          operation: 'wo.job-assigned-notify',
          tenantRef: event.tenantId,
          result: 'success',
        });
        return 'skipped';
      }

      // ONE logical notification. The publisher already chose the channel from the
      // content the tenant actually authored; this file neither fans out nor
      // guesses, and a channel it does not recognise is refused upstream.
      const queued = await notificationService().enqueuePrepared(db, {
        ...facts,
        // Envelope facts, off the outbox row rather than the payload — one copy of
        // each, so there is no second version free to disagree.
        tenantId: event.tenantId,
        companyId: event.companyId,
        branchId: event.branchId,
        createdBy: event.createdBy,
      });

      if (queued === null) {
        // Neither an insert nor a lookup produced a row: the conflict fired and the
        // existing row could not then be read. That is a fault, not a replay, so it
        // is thrown and the existing retry machinery takes it.
        throw new Error(
          `job.assigned enqueue for ${facts.dedupeKey} neither inserted nor resolved a message`
        );
      }

      log.info('job.assigned enqueued a notification', {
        module: 'outbox-worker',
        operation: 'wo.job-assigned-notify',
        tenantRef: event.tenantId,
        result: 'success',
        context: { deduplicated: queued.deduplicated, channel: facts.channel },
      });
      return 'applied';
    },
  });
}
