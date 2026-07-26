/**
 * Domain-event envelope and catalog (P1-13-BE-015, P1-13-DOC-002).
 *
 * The envelope mirrors `shared.event_outbox` exactly, because the outbox row IS
 * the envelope — there is no second serialization to drift from it. Every field
 * below maps to a column whose CHECK constraint is reproduced here, so a bad
 * envelope fails in TypeScript with a readable message instead of as a
 * constraint violation from four layers down.
 *
 * The catalog is a reserved-name registry, not a set of implementations. P1-13
 * publishes no domain events; it fixes the names, schema versions, and owning
 * modules so Phases 1-14…1-23 cannot invent conflicting ones. `EVT-` codes come
 * from the Chapter 4 Table 4.5 allocation.
 */

/** Regexes taken verbatim from the frozen `shared.event_outbox` CHECK constraints. */
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{1,62}$/;
const AGGREGATE_TYPE = /^[a-z][a-z0-9_.-]{1,62}$/;
const PRODUCER = /^[a-z][a-z0-9_.-]{1,62}$/;
const EVENT_KEY_MAX = 255;

export interface EventCatalogEntry {
  /** Allocation code from the architecture chapter, e.g. `EVT-IAM-001`. */
  readonly code: string;
  /** Wire name written to `event_outbox.event_type`, e.g. `access.grant.changed`. */
  readonly eventType: string;
  /** Payload schema version. Bumped on an incompatible payload change. */
  readonly schemaVersion: number;
  readonly aggregateType: string;
  /** Module that may publish it. Enforced by `publishEvent()`. */
  readonly owner: string;
  /** Phase that implements publication. `null` while reserved only. */
  readonly implementedIn: string | null;
  readonly description: string;
}

/**
 * Reserved event names. Registering a name here does not publish it; it prevents
 * two phases from choosing the same wire name with different payloads.
 */
export const EVENT_CATALOG: readonly EventCatalogEntry[] = Object.freeze([
  {
    code: 'EVT-IAM-001',
    eventType: 'access.grant.changed',
    schemaVersion: 1,
    aggregateType: 'iam.role_grant',
    owner: 'iam',
    implementedIn: 'P1-14',
    description: 'A role grant was created, modified, or revoked for a user.',
  },
  {
    code: 'EVT-IAM-002',
    eventType: 'user.invited',
    schemaVersion: 1,
    aggregateType: 'iam.user_account',
    owner: 'iam',
    implementedIn: 'P1-14',
    description: 'A user was invited to a tenant and an invited account was created for them.',
  },
  {
    code: 'EVT-IAM-003',
    eventType: 'user.status.changed',
    schemaVersion: 1,
    aggregateType: 'iam.user_account',
    owner: 'iam',
    implementedIn: 'P1-14',
    description:
      'An account moved between invited, active, locked, and archived. One event covers every transition because consumers react to the resulting state, not to the verb.',
  },
  {
    code: 'EVT-IAM-004',
    eventType: 'session.revoked',
    schemaVersion: 1,
    aggregateType: 'iam.user_session',
    owner: 'iam',
    implementedIn: 'P1-14',
    description: 'A session was revoked. Revocation is terminal and takes effect immediately.',
  },
  {
    code: 'EVT-CRM-001',
    eventType: 'business-partner.merged',
    schemaVersion: 1,
    aggregateType: 'crm.business_partner',
    owner: 'crm',
    implementedIn: 'P1-16',
    description: 'Two business partners were merged; the survivor is the aggregate.',
  },
  {
    code: 'EVT-CRM-002',
    eventType: 'business-partner.created',
    schemaVersion: 1,
    aggregateType: 'crm.business_partner',
    owner: 'crm',
    implementedIn: 'P1-16',
    description:
      'A customer was created. One event covers individuals and organizations because a consumer reacts to a customer existing, not to which profile table holds its name. The payload carries no personal data: a consumer that needs the name reads the aggregate under its own authorization.',
  },
  {
    code: 'EVT-CRM-003',
    eventType: 'consent.changed',
    schemaVersion: 1,
    aggregateType: 'crm.business_partner',
    owner: 'crm',
    implementedIn: 'P1-16',
    description:
      'A customer consent decision was recorded. Published because consent changes what the whole platform may do to that customer, so notification and messaging consumers must react. Carries the prior status so a consumer can tell a grant from a re-affirmation.',
  },
  {
    code: 'EVT-VEH-001',
    eventType: 'vehicle.relationship.changed',
    schemaVersion: 1,
    aggregateType: 'veh.vehicle',
    owner: 'veh',
    implementedIn: 'P1-17',
    description: 'A vehicle ownership or authorised-person relationship changed.',
  },
  {
    // P1-17 allocation (beyond the Chapter 4 Table 4.5 reservation, as P1-15 did
    // for its own document/template events): a consumer reacts to a vehicle
    // existing, so apt/rec/wo can reference it. Payload carries no VIN, plate, or
    // owner — a consumer that needs them reads the aggregate under its own
    // authorization.
    code: 'EVT-VEH-002',
    eventType: 'vehicle.created',
    schemaVersion: 1,
    aggregateType: 'veh.vehicle',
    owner: 'veh',
    implementedIn: 'P1-17',
    description: 'A vehicle master was created as a draft.',
  },
  {
    // P1-17 allocation. The survivor is the aggregate — the vehicle that
    // continues to exist and that a consumer must re-read. Payload names the
    // source, survivor, and merge id only.
    code: 'EVT-VEH-003',
    eventType: 'vehicle.merged',
    schemaVersion: 1,
    aggregateType: 'veh.vehicle',
    owner: 'veh',
    implementedIn: 'P1-17',
    description: 'A duplicate vehicle was merged into a surviving vehicle.',
  },
  {
    // P1-18 allocation. One event for every appointment lifecycle change —
    // booked, rescheduled, cancelled, no-show — because a consumer's reaction is
    // always the same: re-read the appointment. The payload names the resulting
    // lifecycle status so a consumer need not diff.
    code: 'EVT-APT-001',
    eventType: 'appointment.changed',
    schemaVersion: 1,
    aggregateType: 'apt.appointment',
    owner: 'apt',
    implementedIn: 'P1-18',
    description: 'An appointment was booked, rescheduled, cancelled, or recorded as a no-show.',
  },
  {
    // P1-18 allocation. Chapter 4 Table 4.5 and the P1-08 boundary record both
    // allocate this exact name for the check-in fact; P1-18's own Field 24 calls
    // the same fact `reception.vehicle-checked-in.v1`. The reserved catalog entry
    // wins and no duplicate is minted — one fact must not have two event names.
    code: 'EVT-REC-001',
    eventType: 'vehicle.checked-in',
    schemaVersion: 1,
    aggregateType: 'rec.reception_visit',
    owner: 'rec',
    implementedIn: 'P1-18',
    description: 'A vehicle was received and custody was accepted.',
  },
  {
    // P1-18 allocation, newly registered: no reserved entry covered it. Approval
    // is a distinct fact from check-in — it is the point at which the visit is
    // released for work — and P1-18 Field 24 requires it. Reception-to-work-order
    // conversion deliberately emits NO event: the approved event catalog contains
    // none for it, and inventing one would create a contract no consumer agreed to.
    code: 'EVT-REC-002',
    eventType: 'reception.approved',
    schemaVersion: 1,
    aggregateType: 'rec.reception_visit',
    owner: 'rec',
    implementedIn: 'P1-18',
    description: 'A reception visit was authorized and released for work.',
  },
  {
    code: 'EVT-DOC-001',
    eventType: 'document.accepted',
    schemaVersion: 1,
    aggregateType: 'shared.document',
    owner: 'shared',
    implementedIn: null,
    description: 'A document version passed scanning and was accepted.',
  },
  {
    code: 'EVT-NTF-001',
    eventType: 'message.delivery.changed',
    schemaVersion: 1,
    aggregateType: 'shared.outbound_message',
    // Deliberately still unimplemented after P1-15, and the reason is
    // structural rather than an omission: delivery state changes on the
    // **worker** archetype, which has no `RequestContext` (see
    // `server/worker/worker-db.ts` — its policies are all-tenant precisely
    // because a dispatcher must see every tenant's queue). `publishEvent()`
    // takes its tenant, actor, and correlation from that context and cannot be
    // called without one. The durable record of a delivery state change is the
    // message row plus its append-only `shared.delivery_attempts` history;
    // emitting an envelope as well needs a worker-side publication path that
    // this phase did not build. Marking it implemented would have been a claim
    // about a producer that does not exist.
    owner: 'shared',
    implementedIn: null,
    description: 'An outbound message changed delivery state.',
  },

  // ---- Shared services (P1-15) --------------------------------------------
  //
  // Every entry below is owned by `shared`, including the one about an `org`
  // aggregate: the P1-15 status-transition engine is the publisher, and the
  // catalog's `owner` names the module allowed to publish, not the schema the
  // aggregate lives in. Giving it to `org` would mean no module could publish
  // it, since no `org` module exists.
  //
  // Names carry no version suffix. The planning text used `….v1`; the schema
  // version is a separate column (`schema_version`) and duplicating it in the
  // wire name would produce two ways to express the same fact.
  {
    code: 'EVT-DOC-002',
    eventType: 'document.version.registered',
    schemaVersion: 1,
    aggregateType: 'shared.document',
    owner: 'shared',
    implementedIn: 'P1-15',
    description:
      'A pending document version was registered against a document. Carries no storage key and no checksum — a consumer that needs either reads the row under its own authorization.',
  },
  {
    code: 'EVT-DOC-003',
    eventType: 'document.link.changed',
    schemaVersion: 1,
    aggregateType: 'shared.document',
    owner: 'shared',
    implementedIn: 'P1-15',
    description:
      'A document was linked to, or unlinked from, a business entity. One event covers both because consumers react to the resulting reachability.',
  },
  {
    code: 'EVT-NTF-002',
    eventType: 'message.enqueued',
    schemaVersion: 1,
    aggregateType: 'shared.outbound_message',
    owner: 'shared',
    implementedIn: 'P1-15',
    description:
      'An outbound message was enqueued. Carries no recipient, no rendered content, and no template body.',
  },
  {
    code: 'EVT-TPL-001',
    eventType: 'message-template.version.changed',
    schemaVersion: 1,
    aggregateType: 'shared.message_template',
    owner: 'shared',
    implementedIn: 'P1-15',
    description:
      'A template version was created, approved, retired, or activated. One event because consumers cache by template and need to invalidate on any of them.',
  },
  {
    code: 'EVT-ORG-001',
    eventType: 'organization.branch.status.changed',
    schemaVersion: 1,
    aggregateType: 'org.branch',
    owner: 'shared',
    implementedIn: 'P1-15',
    description: 'A branch was activated or deactivated through the status-transition engine.',
  },
  // ---------------------------------------------------------------------------
  // P1-19 allocation (wo / tech / dia / qms). See
  // docs/phase-1/phase-1-19/change-requests/ECR-P1-19-001-event-catalog.md.
  //
  // No reserved entry covered these: EVT-WO-*, EVT-TECH-*, EVT-DIA-* and EVT-QMS-*
  // did not exist anywhere in the repository. Two conflicting name sets were
  // proposed for them — one in the P1-19 execution brief, one in the P1-09 handoff
  // — and both suffixed the wire name `.v1`. Neither is followed literally here:
  //
  //   * The type strings stay UNSUFFIXED, matching all twenty entries above.
  //     Version is carried by `schemaVersion`, which is what that field is for;
  //     encoding it twice would let the two disagree.
  //   * Granularity follows the P1-09 handoff, because it was written by the phase
  //     that owns the schema, and because `wo.work_order_status_history` already
  //     records created / changed / closed as distinct facts.
  //
  // `implementedIn` stays null until the wave that actually publishes each event
  // lands — a reserved name is not an implementation, and claiming otherwise is
  // how a catalog stops being trustworthy.
  // ---------------------------------------------------------------------------
  {
    code: 'EVT-WOR-001',
    eventType: 'work-order.created',
    schemaVersion: 1,
    aggregateType: 'wo.work_order',
    owner: 'wo',
    implementedIn: null,
    description: 'A work order was created from a reception visit.',
  },
  {
    code: 'EVT-WOR-002',
    eventType: 'work-order.state-changed',
    schemaVersion: 1,
    aggregateType: 'wo.work_order',
    owner: 'wo',
    implementedIn: 'P1-19',
    description: 'A work order moved between states in its configured graph.',
  },
  {
    // Separate from state-changed even though closure IS a state change, because
    // closure is the fact downstream consumers (billing, warranty, reporting) wait
    // for, and making them filter every transition to find it would put the
    // definition of "closed" in each consumer instead of here.
    code: 'EVT-WOR-003',
    eventType: 'work-order.closed',
    schemaVersion: 1,
    aggregateType: 'wo.work_order',
    owner: 'wo',
    implementedIn: 'P1-19',
    description: 'A work order reached a terminal, non-cancellation state.',
  },
  {
    // Owner is 'wo', not 'tech', and the aggregate is why: the assignment row
    // lives in wo.job_assignments and is written by the work-order module.
    // buildEventEnvelope refuses a producer whose leading segment differs from the
    // owner, so 'tech' here would have made Wave 5's own write path throw.
    code: 'EVT-TEC-001',
    eventType: 'job.assigned',
    schemaVersion: 1,
    aggregateType: 'wo.job',
    owner: 'wo',
    implementedIn: 'P1-19',
    description: 'A technician was assigned to a job.',
  },
  {
    code: 'EVT-TEC-002',
    eventType: 'job.state-changed',
    schemaVersion: 1,
    aggregateType: 'wo.job',
    owner: 'wo',
    implementedIn: 'P1-19',
    description: 'A job moved between states in its configured graph.',
  },
  {
    code: 'EVT-TEC-003',
    eventType: 'labor.session-changed',
    schemaVersion: 1,
    aggregateType: 'tech.labor_session',
    owner: 'tech',
    implementedIn: null,
    description: 'A labor session was started, paused, resumed or stopped.',
  },
  {
    code: 'EVT-WOR-004',
    eventType: 'additional-work.requested',
    schemaVersion: 1,
    aggregateType: 'wo.additional_work_request',
    owner: 'wo',
    implementedIn: null,
    description: 'Additional work was raised against a work order.',
  },
  {
    code: 'EVT-WOR-005',
    eventType: 'customer-approval.recorded',
    schemaVersion: 1,
    aggregateType: 'wo.customer_approval',
    owner: 'wo',
    implementedIn: null,
    description: 'A customer decision on additional work was recorded.',
  },
  {
    code: 'EVT-DIA-001',
    eventType: 'diagnostic-report.completed',
    schemaVersion: 1,
    aggregateType: 'dia.diagnostic_report',
    owner: 'dia',
    implementedIn: null,
    description: 'A diagnostic report was completed against its pinned template version.',
  },
  {
    code: 'EVT-QMS-001',
    eventType: 'quality-control.finalized',
    schemaVersion: 1,
    aggregateType: 'qms.quality_control_record',
    owner: 'qms',
    implementedIn: null,
    description: 'A quality-control record was finalized as passed or failed.',
  },
  {
    code: 'EVT-QMS-002',
    eventType: 'rework.linked',
    schemaVersion: 1,
    aggregateType: 'qms.rework_link',
    owner: 'qms',
    implementedIn: null,
    description: 'A rework case was linked to the work order it corrects, or signed off.',
  },
]);

export function findEvent(eventType: string): EventCatalogEntry | undefined {
  return EVENT_CATALOG.find((entry) => entry.eventType === eventType);
}

/** The envelope written into the producer's transaction. */
export interface EventEnvelope {
  /** Idempotent publication key, unique per tenant (`uq_event_outbox_event_key`). */
  readonly eventKey: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly producer: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly payload: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
  readonly companyId: string | null;
  readonly branchId: string | null;
}

export class EventEnvelopeError extends Error {
  public override readonly name = 'EventEnvelopeError';
}

export interface BuildEnvelopeInput {
  readonly eventType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly producer: string;
  readonly payload: Record<string, unknown>;
  readonly correlationId: string;
  readonly causationId?: string | null;
  readonly eventKey: string;
  readonly companyId?: string | null;
  readonly branchId?: string | null;
  readonly occurredAt?: Date;
  readonly headers?: Record<string, unknown>;
}

/**
 * Builds and validates an envelope against the catalog and the column contracts.
 * An unregistered event type is rejected: an event nobody declared is an event
 * no consumer can be written against.
 */
export function buildEventEnvelope(input: BuildEnvelopeInput): EventEnvelope {
  const entry = findEvent(input.eventType);
  if (!entry) {
    throw new EventEnvelopeError(
      `Event type "${input.eventType}" is not in the event catalog. Register it before publishing.`
    );
  }
  if (!EVENT_TYPE.test(input.eventType)) {
    throw new EventEnvelopeError(`Event type "${input.eventType}" violates the column format`);
  }
  if (!AGGREGATE_TYPE.test(entry.aggregateType)) {
    throw new EventEnvelopeError(
      `Aggregate type "${entry.aggregateType}" violates the column format`
    );
  }
  if (!PRODUCER.test(input.producer)) {
    throw new EventEnvelopeError(`Producer "${input.producer}" violates the column format`);
  }
  // The catalog's `owner` column is enforced, not documentary: the owning module
  // is the authority for what an event name means, and a second module
  // publishing it would make the meaning ambiguous with no way to tell which
  // producer a consumer is reacting to. The producer id is `<module>` or
  // `<module>.<component>`, so the leading segment is the claim being checked.
  //
  // P1-13 documented this rule in the Event Catalog standard without
  // implementing it; P1-14 implements it rather than leaving a security-shaped
  // claim unbacked.
  const producerModule = input.producer.split('.')[0];
  if (producerModule !== entry.owner) {
    throw new EventEnvelopeError(
      `Producer "${input.producer}" may not publish "${input.eventType}": the catalog assigns ` +
        `that event to module "${entry.owner}".`
    );
  }
  if (input.eventKey.trim().length === 0 || input.eventKey.length > EVENT_KEY_MAX) {
    throw new EventEnvelopeError(`Event key must be 1–${EVENT_KEY_MAX} non-blank characters`);
  }
  if (!Number.isInteger(input.aggregateVersion) || input.aggregateVersion < 1) {
    throw new EventEnvelopeError('Aggregate version must be an integer >= 1');
  }

  return {
    eventKey: input.eventKey,
    eventType: input.eventType,
    schemaVersion: entry.schemaVersion,
    aggregateType: entry.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    producer: input.producer,
    occurredAt: input.occurredAt ?? new Date(),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    payload: input.payload,
    headers: input.headers ?? {},
    companyId: input.companyId ?? null,
    branchId: input.branchId ?? null,
  };
}
