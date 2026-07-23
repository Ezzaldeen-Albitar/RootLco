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
    implementedIn: null,
    description: 'Two business partners were merged; the survivor is the aggregate.',
  },
  {
    code: 'EVT-VEH-001',
    eventType: 'vehicle.relationship.changed',
    schemaVersion: 1,
    aggregateType: 'veh.vehicle',
    owner: 'veh',
    implementedIn: null,
    description: 'A vehicle ownership or authorised-person relationship changed.',
  },
  {
    code: 'EVT-APT-001',
    eventType: 'appointment.changed',
    schemaVersion: 1,
    aggregateType: 'apt.appointment',
    owner: 'apt',
    implementedIn: null,
    description: 'An appointment was booked, rescheduled, or cancelled.',
  },
  {
    code: 'EVT-REC-001',
    eventType: 'vehicle.checked-in',
    schemaVersion: 1,
    aggregateType: 'rec.reception_visit',
    owner: 'rec',
    implementedIn: null,
    description: 'A vehicle was received and custody was accepted.',
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
    owner: 'shared',
    implementedIn: 'P1-15',
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
  // Names carry no version suffix. The planning text used `…​.v1`; the schema
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
    description:
      'A branch was activated or deactivated through the status-transition engine.',
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
