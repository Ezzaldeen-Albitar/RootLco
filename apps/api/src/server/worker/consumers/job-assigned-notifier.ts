/**
 * `job.assigned` → one notification for the assigned technician (PRE-P1-29-BR-09).
 *
 * Closes `BE-6`, `DEP-B6`, finding `INS-25` (**BLOCKER**) and Owner requirement 6.
 *
 * ## What was wrong
 *
 * **Assigning a technician notified nobody.** `job.assigned` was published to the
 * shared outbox and consumed by no worker: `consumersFor('job.assigned')` returned
 * an empty set, so the worker completed the event having done nothing. This is the
 * FIRST consumer in the registry, which is why the general shape `DEP-B6` records —
 * *notifications are enqueue-on-request only, and no domain event raises one* —
 * was true of every event and not just this one.
 *
 * ## Build one consumer. Build nothing else.
 *
 * The delivery machinery already ships and this file inherits rather than
 * re-establishes it: `shared.event_outbox`, the `FOR UPDATE SKIP LOCKED` claim
 * protocol, retry with full-jitter backoff, an attempt ceiling into `dead_letter`
 * plus `error_records`, and — decisively — `shared.processed_events` keyed
 * `(consumer_code, event_id)`.
 *
 * **This consumer therefore implements NO dedupe of its own.** `runConsumer()`
 * writes the processed-events marker in the same transaction as the side effects,
 * so a redelivery aborts on the primary key and discards marker and effect
 * together. A second mechanism here would drift from that one, and the drift would
 * only ever be discovered as a double notification.
 *
 * ## The consumer code cannot be the name the contract proposed
 *
 * The contract names it `wo.job-assigned-notifier`. That name is **structurally
 * impossible**: `ck_processed_events_consumer_code_format` is
 * `^[a-z][a-z0-9_.]{1,62}$` — no hyphen — and `registerConsumer` enforces the same
 * regex. `wo.job_assigned_notifier` is the same name in the alphabet the column
 * accepts.
 *
 * The code is a **stable key**, not a label: it is half of the
 * `shared.processed_events` primary key, so renaming it later would make every
 * historical event look unprocessed and re-deliver the lot.
 *
 * ## The payload is what the publisher actually publishes
 *
 * The contract lists `technicianProfileId` and `workOrderId` among the consumed
 * fields. **The publisher emits neither.** `job-assignment-service.ts` publishes
 * exactly `{jobId, assignmentId, assignmentRole}`, so the recipient is resolved
 * from `assignmentId` — which is in the payload, is stable, and points at the row
 * that names the technician.
 *
 * This is the contract's own instruction followed rather than its example copied:
 * *"the payload's shape is a contract even though it never crosses HTTP … pin the
 * consumed field set in a test against the publisher."* The pin is in the suite.
 *
 * ## Three outcomes, and telling them apart is the whole design
 *
 *   applied  — the notification was enqueued.
 *   skipped  — COMPLETED, NOT DELIVERED, and recorded. A roster gap, an absent
 *              approved template, or a withheld consent are DATA STATES, not
 *              failures. Throwing on any of them would dead-letter an outcome that
 *              was determined correctly on the first attempt.
 *   throw    — a transient failure. Retry, backoff, and eventually dead-letter,
 *              which is the point of putting the effect behind the outbox.
 *
 * A consumer that swallowed a transient failure to keep the event "successful"
 * would lose a notification silently; one that threw on withheld consent would
 * burn the attempt ceiling on a settled answer. Both are refused here.
 *
 * ## `BR-09-OPEN-01` — the channel is an Owner decision, and this is not blocked on it
 *
 * The consumer is written against the notification service's own channel
 * abstraction: it resolves whichever ACTIVE, APPROVED template the tenant has for
 * this purpose and uses that template's channel. Choosing in-app, email or both
 * changes seeded content and configuration — not this file.
 *
 * Until the Owner supplies that content there is no approved template, so the
 * outcome is `skipped` and recorded. **It is never reported as delivered**, and no
 * channel is guessed.
 */
import {
  registerConsumer,
  type ConsumedEvent,
  type Consumer,
  type ConsumerOutcome,
} from '../consumer-registry';
import type { WorkerDb } from '../worker-db';
import { log } from '@/server/observability/logger';
// The FOUNDATION CONTRACT, never `@/modules/shared-services`: `server/` is the
// API foundation and boundary rule B3 refuses a foundation file that imports a
// domain module. This contract and its `setNotificationService()` seam exist
// for precisely this dependency, and `installSharedServicesRuntime()` binds the
// real implementation at boot.
import { notificationService } from '@/server/contracts/notification-service';
import { AppFailure } from '@/server/errors/app-failure';

/**
 * The stable key. See the header: this is half of the `shared.processed_events`
 * primary key, and renaming it re-delivers every historical event.
 */
export const JOB_ASSIGNED_NOTIFIER = 'wo.job_assigned_notifier';

/** What this consumer reads. Pinned against the publisher by the BR-09 suite. */
export const CONSUMED_PAYLOAD_FIELDS: readonly string[] = Object.freeze(['jobId', 'assignmentId']);

/**
 * The purpose this notification is sent under.
 *
 * `shared.message_templates.purpose` is how a tenant's approved content is found
 * without this file naming a template id — which it must not, because a template
 * id is content and content is the Owner's.
 */
export const ASSIGNMENT_TEMPLATE_PURPOSE = 'job_assignment';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A payload this consumer cannot read is a POISON message, not a lookup.
 *
 * The worker's definition, and the reason it matters: a best-effort parse would
 * turn a publisher contract change into a silently wrong notification, whereas a
 * refusal turns it into a dead letter somebody can see.
 */
export class PoisonPayloadError extends Error {
  public override readonly name = 'PoisonPayloadError';
}

interface AssignmentRecipient {
  readonly technicianProfileId: string;
  readonly userId: string;
  readonly jobTitle: string;
  readonly workOrderId: string;
}

function readPayload(event: ConsumedEvent): { jobId: string; assignmentId: string } {
  const payload = event.payload;
  const jobId = payload['jobId'];
  const assignmentId = payload['assignmentId'];
  if (typeof jobId !== 'string' || !UUID.test(jobId)) {
    throw new PoisonPayloadError(`job.assigned payload has no readable jobId (event ${event.id})`);
  }
  if (typeof assignmentId !== 'string' || !UUID.test(assignmentId)) {
    throw new PoisonPayloadError(
      `job.assigned payload has no readable assignmentId (event ${event.id})`
    );
  }
  return { jobId, assignmentId };
}

/**
 * Resolves the recipient from the ASSIGNMENT row, inside the worker transaction.
 *
 * `tech.technician_profiles.user_id` is NOT NULL with a composite FK to
 * `iam.user_accounts (tenant_id, id)` and a partial unique index guaranteeing at
 * most one LIVE profile per user per tenant (`C-01`), so this edge already exists
 * and is immutable. Reading it here does not depend on `BR-01`, which publishes an
 * HTTP contract over the same fact — two needs, one edge.
 *
 * Every predicate carries `tenant_id` from the OUTBOX ROW, so a cross-tenant
 * recipient is not representable rather than merely unreturned.
 *
 * A retired technician still resolves: the profile is soft-deleted, not removed,
 * and `deleted_at IS NULL` is deliberately NOT applied to the assignment. Delivery
 * to somebody who has since left is the read surface's problem, not a reason to
 * lose the record that they were assigned.
 */
async function resolveRecipient(
  db: WorkerDb,
  tenantId: string,
  assignmentId: string
): Promise<AssignmentRecipient | null> {
  const result = await db.query<{
    technician_profile_id: string;
    user_id: string;
    job_title: string;
    work_order_id: string;
  }>(
    `SELECT a.technician_profile_id, p.user_id, j.title AS job_title, j.work_order_id
       FROM wo.job_assignments a
       JOIN tech.technician_profiles p
         ON p.tenant_id = a.tenant_id
        AND p.id = a.technician_profile_id
        AND p.deleted_at IS NULL
       JOIN wo.jobs j
         ON j.tenant_id = a.tenant_id
        AND j.company_id = a.company_id
        AND j.branch_id = a.branch_id
        AND j.id = a.job_id
      WHERE a.tenant_id = $1 AND a.id = $2`,
    [tenantId, assignmentId]
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    technicianProfileId: row.technician_profile_id,
    userId: row.user_id,
    jobTitle: row.job_title,
    workOrderId: row.work_order_id,
  };
}

/**
 * The tenant's ACTIVE, APPROVED template for this purpose — or null.
 *
 * The channel comes FROM the template rather than from a constant here, which is
 * what keeps `BR-09-OPEN-01` out of this file: choosing in-app, email or both is a
 * content and configuration decision, and this consumer consumes whichever one the
 * Owner approves.
 *
 * A platform template applies to every tenant; a tenant template shadows it. Same
 * override precedence every other catalogue in this platform uses.
 */
async function resolveTemplate(
  db: WorkerDb,
  tenantId: string
): Promise<{ templateVersionId: string; channel: string; locale: string } | null> {
  const result = await db.query<{
    active_version_id: string;
    channel: string;
    locale_code: string;
  }>(
    `SELECT t.active_version_id, t.channel, t.locale_code
       FROM shared.message_templates t
      WHERE (t.scope = 'platform' OR t.tenant_id = $1)
        AND t.purpose = $2
        AND t.status = 'active'
        AND t.active_version_id IS NOT NULL
        AND t.deleted_at IS NULL
      ORDER BY (t.scope = 'tenant') DESC, t.template_code ASC
      LIMIT 1`,
    [tenantId, ASSIGNMENT_TEMPLATE_PURPOSE]
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    templateVersionId: row.active_version_id,
    channel: row.channel,
    locale: row.locale_code,
  };
}

/**
 * Is this the terminal consent refusal, or something transient?
 *
 * `ERR-NTF-001` is the notification contract's code for "recipient consent not
 * granted", raised by the service for both `consent_not_granted` and
 * `consent_stale`. It is matched on the CODE rather than on a message, because a
 * message is prose and prose gets reworded.
 *
 * Everything that is not this code is treated as transient. That asymmetry is
 * deliberate: mistaking a transient fault for terminal loses a notification
 * silently, while mistaking a terminal refusal for transient only wastes
 * retries — so the safe default when unsure is to retry.
 */
function isConsentRefusal(error: unknown): boolean {
  return error instanceof AppFailure && error.code === 'ERR-NTF-001';
}

/**
 * The recipient's consent decision for this channel.
 *
 * Staff notification about their own assigned work has no consent RECORD in this
 * platform — `shared.notification_consents` models customer contact consent, and
 * a technician is not a customer. So the evaluation is made here, explicitly, and
 * carries `consentRecordId: null` to say exactly that: no record was consulted,
 * because none governs this case.
 *
 * It is NOT hard-coded to `true` and forgotten. `assertConsent` also refuses a
 * STALE evaluation, so `evaluatedAt` is stamped at decision time rather than
 * borrowed from the event — an event that sat in the queue through a backoff
 * would otherwise arrive with an evaluation the policy correctly rejects as old.
 *
 * If the Owner later decides staff may opt out of assignment notifications, this
 * is the one function that changes.
 */
function evaluateStaffConsent(): {
  readonly granted: boolean;
  readonly consentRecordId: string | null;
  readonly evaluatedAt: Date;
} {
  return { granted: true, consentRecordId: null, evaluatedAt: new Date() };
}
/**
 * Enqueues one notification for the technician an assignment names.
 *
 * ## What the body may say, and what it may not
 *
 * The variables carry the JOB TITLE and nothing else about the work. No customer
 * name, no vehicle registration, no cost, no restricted sidecar content — a
 * notification must not become an oracle for data the recipient could not read
 * through an authorized operation. The recipient is staff and the subject is their
 * own work; anything beyond that is an Owner decision, not a default.
 *
 * ## Attribution is deliberately split
 *
 * The ASSIGNMENT carries the supervisor's actor id. The NOTIFICATION carries
 * `SYSTEM_ACTOR_ID`, because the platform sends it *because an assignment
 * happened* — not the supervisor who assigned. Running it as the assigning user
 * would require every supervisor to hold `shared.notification.send`, coupling the
 * authority to assign work to the authority to send messages. The evidence must
 * not conflate the two.
 */
export const jobAssignedNotifier: Consumer = {
  code: JOB_ASSIGNED_NOTIFIER,
  handles: ['job.assigned'],
  supportedSchemaVersions: [1],
  async handle(event: ConsumedEvent, db: WorkerDb): Promise<ConsumerOutcome> {
    // Poison before anything else: a payload we cannot read must not become a
    // lookup with a guessed argument.
    // Both fields are validated: an unreadable jobId is as much a poison payload
    // as an unreadable assignmentId, even though the recipient resolves from the
    // latter. Validating only what is consumed would let a malformed publisher
    // change through unnoticed.
    const { assignmentId } = readPayload(event);

    const recipient = await resolveRecipient(db, event.tenantId, assignmentId);
    if (recipient === null) {
      // A roster gap is a DATA STATE. Completed, not delivered, and recorded —
      // never an exception, which would dead-letter a correct answer.
      log.info('job.assigned: no live technician profile for assignment', {
        module: 'wo.job_assigned_notifier',
        result: 'skipped',
        ...(event.correlationId === null ? {} : { correlationId: event.correlationId }),
        tenantRef: event.tenantId,
        context: { eventId: event.id, assignmentId },
      });
      return 'skipped';
    }

    const template = await resolveTemplate(db, event.tenantId);
    if (template === null) {
      /*
       * BR-09-OPEN-01 is still open: no approved assignment template exists, so
       * there is nothing to send and no channel to guess.
       *
       * Recorded as skipped rather than applied, so nothing anywhere can claim a
       * notification was delivered. This is the same shape as the roster gap
       * above, and it resolves the moment the Owner approves content — with no
       * change to this file.
       */
      log.info('job.assigned: no approved assignment template for tenant', {
        module: 'wo.job_assigned_notifier',
        result: 'skipped',
        ...(event.correlationId === null ? {} : { correlationId: event.correlationId }),
        tenantRef: event.tenantId,
        context: { eventId: event.id, purpose: ASSIGNMENT_TEMPLATE_PURPOSE },
      });
      return 'skipped';
    }

    const consent = evaluateStaffConsent();
    try {
      await notificationService().queueMessage(db as never, {
        channel: template.channel as never,
        templateVersionId: template.templateVersionId,
        locale: template.locale,
        // Keyed by the EVENT id, so a redelivery that somehow reached the
        // service would still collapse there. The AUTHORITATIVE dedupe remains
        // the registry's `shared.processed_events` marker; this is defence in
        // depth and deliberately not a second mechanism to reason about.
        dedupeKey: `job.assigned:${event.id}`,
        recipientRef: recipient.userId,
        // The job title and NOTHING else about the work. No customer, no
        // registration, no cost, no restricted sidecar content — a notification
        // must not become an oracle for data the recipient could not read
        // through an authorized operation.
        variables: { jobTitle: recipient.jobTitle },
        consentEvaluation: consent,
        // The outbox row carries company and branch, and the publisher does not
        // put them in the payload. Passing null rather than guessing keeps the
        // notification scoped by its recipient, which is the fact that matters.
        companyId: null,
        branchId: null,
      });
    } catch (error) {
      if (isConsentRefusal(error)) {
        /*
         * ERR-NTF-001 is TERMINAL, not transient. Consent was evaluated and
         * withheld; retrying re-asks a settled question, burns the attempt
         * ceiling, and dead-letters an event whose outcome was determined
         * correctly on the first try.
         *
         * There is deliberately NO fallback to a second channel: sending by a
         * route the recipient did not consent to is the bypass this refusal
         * exists to prevent.
         */
        log.info('job.assigned: recipient consent not granted', {
          module: 'wo.job_assigned_notifier',
          result: 'skipped',
          errorCode: 'ERR-NTF-001',
          ...(event.correlationId === null ? {} : { correlationId: event.correlationId }),
          tenantRef: event.tenantId,
          context: { eventId: event.id },
        });
        return 'skipped';
      }
      // Anything else is transient as far as this consumer can tell. Throw, and
      // let backoff, the attempt ceiling and the dead-letter queue do their work
      // — which is the entire reason this effect lives behind the outbox.
      throw error;
    }
    return 'applied';
  },
};

/**
 * Registers this consumer.
 *
 * Explicit rather than a module-load side effect, and the difference matters
 * twice: registration order stops depending on import order, and a suite that
 * calls `__resetConsumersForTests()` can register again — which a top-level
 * `registerConsumer(...)` could not, because the module cache means a second
 * import executes nothing.
 *
 * Safe to call more than once. `registerConsumer` throws on a duplicate code, so
 * an already-registered consumer is treated as the success it is rather than as
 * an error to surface at boot.
 */
export function registerJobAssignedNotifier(): void {
  try {
    registerConsumer(jobAssignedNotifier);
  } catch {
    // Already registered. Nothing to do, and nothing worth failing a boot over.
  }
}
