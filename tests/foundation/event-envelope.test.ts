/**
 * Protects the envelope's role as the last checkpoint before a row is written to
 * `shared.event_outbox`.
 *
 * The column CHECK constraints are reproduced in TypeScript so a bad envelope
 * fails with a readable message instead of as a constraint violation from four
 * layers down — but that is only true while every constraint is actually
 * enforced here, which is what these assertions pin.
 *
 * The catalog gate matters for a different reason: an event nobody declared is an
 * event no consumer can be written against, and two phases inventing the same
 * wire name with different payloads is a defect that only shows up in production
 * after both have shipped. Uniqueness of the reserved names is therefore part of
 * the contract, not a tidiness check.
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT_CATALOG,
  EventEnvelopeError,
  buildEventEnvelope,
  findEvent,
  type BuildEnvelopeInput,
} from '@/server/events/envelope';

const CORRELATION_ID = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
const CAUSATION_ID = '9b1c3d4e-6f70-4182-9345-a6b7c8d9e0f1';
const AGGREGATE_ID = '11111111-2222-4333-8444-555555555555';

const VALID: BuildEnvelopeInput = {
  eventType: 'access.grant.changed',
  aggregateId: AGGREGATE_ID,
  aggregateVersion: 1,
  producer: 'iam',
  payload: { grantId: AGGREGATE_ID },
  correlationId: CORRELATION_ID,
  eventKey: 'iam.role-grant.11111111.v1',
};

describe('catalog gate', () => {
  it('rejects an event type that nobody registered', () => {
    expect(() => buildEventEnvelope({ ...VALID, eventType: 'invented.event' })).toThrow(
      EventEnvelopeError
    );
    expect(() => buildEventEnvelope({ ...VALID, eventType: 'invented.event' })).toThrow(
      /not in the event catalog/
    );
  });

  it('rejects a name that is merely close to a registered one', () => {
    expect(() => buildEventEnvelope({ ...VALID, eventType: 'access.grant.change' })).toThrow(
      /not in the event catalog/
    );
  });

  it('supplies the schema version and aggregate type from the catalog, not the caller', () => {
    const envelope = buildEventEnvelope(VALID);
    const entry = findEvent(VALID.eventType)!;

    expect(envelope.schemaVersion).toBe(entry.schemaVersion);
    expect(envelope.aggregateType).toBe(entry.aggregateType);
    expect(envelope.aggregateType).toBe('iam.role_grant');
  });
});

describe('column contracts', () => {
  it('rejects an aggregate version below 1', () => {
    for (const aggregateVersion of [0, -1]) {
      expect(() => buildEventEnvelope({ ...VALID, aggregateVersion })).toThrow(
        /Aggregate version must be an integer >= 1/
      );
    }
  });

  it('rejects a non-integer aggregate version', () => {
    expect(() => buildEventEnvelope({ ...VALID, aggregateVersion: 1.5 })).toThrow(
      /Aggregate version/
    );
    expect(() => buildEventEnvelope({ ...VALID, aggregateVersion: Number.NaN })).toThrow(
      /Aggregate version/
    );
  });

  it('rejects a blank event key', () => {
    for (const eventKey of ['', '   ']) {
      expect(() => buildEventEnvelope({ ...VALID, eventKey })).toThrow(/non-blank characters/);
    }
  });

  it('rejects an event key longer than the column allows', () => {
    expect(() => buildEventEnvelope({ ...VALID, eventKey: 'k'.repeat(256) })).toThrow(
      /non-blank characters/
    );
    expect(() => buildEventEnvelope({ ...VALID, eventKey: 'k'.repeat(255) })).not.toThrow();
  });

  it('rejects a producer that violates the claimant format', () => {
    for (const producer of ['IAM', '1iam', '', 'i'.repeat(64)]) {
      expect(() => buildEventEnvelope({ ...VALID, producer })).toThrow(
        /violates the column format/
      );
    }
  });
});

describe('envelope construction', () => {
  it('copies the caller-supplied fields verbatim', () => {
    const occurredAt = new Date('2026-07-21T00:00:00.000Z');
    const envelope = buildEventEnvelope({
      ...VALID,
      occurredAt,
      causationId: CAUSATION_ID,
      headers: { source: 'unit-test' },
      companyId: 'company-1',
      branchId: 'branch-1',
    });

    expect(envelope.eventKey).toBe(VALID.eventKey);
    expect(envelope.eventType).toBe(VALID.eventType);
    expect(envelope.aggregateId).toBe(AGGREGATE_ID);
    expect(envelope.aggregateVersion).toBe(1);
    expect(envelope.producer).toBe('iam');
    expect(envelope.occurredAt).toBe(occurredAt);
    expect(envelope.correlationId).toBe(CORRELATION_ID);
    expect(envelope.causationId).toBe(CAUSATION_ID);
    expect(envelope.payload).toEqual({ grantId: AGGREGATE_ID });
    expect(envelope.headers).toEqual({ source: 'unit-test' });
    expect(envelope.companyId).toBe('company-1');
    expect(envelope.branchId).toBe('branch-1');
  });

  it('defaults the optional fields to null or empty rather than to a guess', () => {
    const envelope = buildEventEnvelope(VALID);

    expect(envelope.causationId).toBeNull();
    expect(envelope.companyId).toBeNull();
    expect(envelope.branchId).toBeNull();
    expect(envelope.headers).toEqual({});
    expect(envelope.occurredAt).toBeInstanceOf(Date);
  });
});

describe('reserved-name registry', () => {
  it('allocates every code and wire name exactly once', () => {
    const codes = EVENT_CATALOG.map((entry) => entry.code);
    const eventTypes = EVENT_CATALOG.map((entry) => entry.eventType);

    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(eventTypes).size).toBe(eventTypes.length);
    expect(EVENT_CATALOG.length).toBeGreaterThan(0);
  });

  it('gives every entry a schema version, an owner, and a description', () => {
    for (const entry of EVENT_CATALOG) {
      expect(entry.code).toMatch(/^EVT-[A-Z]{3}-\d{3}$/);
      expect(entry.eventType).toMatch(/^[a-z][a-z0-9_.-]{1,62}$/);
      expect(entry.aggregateType).toMatch(/^[a-z][a-z0-9_.-]{1,62}$/);
      expect(entry.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(entry.owner.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      // `implementedIn` is either null (reserved only) or a phase identifier.
      // P1-13 asserted "always null", which was true while nothing published;
      // the rule the catalog actually states is that the field is set in the
      // same change that adds a producer, never before. Asserting the rule keeps
      // the control after P1-14 started publishing, where "always null" would
      // have had to be deleted.
      if (entry.implementedIn !== null) {
        expect(entry.implementedIn).toMatch(/^P1-\d{2}$/);
      }
    }
  });

  it('marks exactly the events with a real producer as implemented, and no others', () => {
    // A name is not "implemented" because someone hopes to publish it. Each entry
    // below has a real `publishEvent()` call in the module the catalog assigns it
    // to; anything else claiming an implementation is a documentation defect, not
    // a feature.
    //
    // P1-15 added four, all published from `src/modules/shared-services` on the
    // request path. Two shared names are deliberately still absent:
    // `document.accepted`, because acceptance is unavailable while no
    // application role may write `shared.file_scan_results`; and
    // `message.delivery.changed`, because delivery state changes on the worker
    // archetype, which has no `RequestContext` and therefore cannot call
    // `publishEvent()`.
    const implemented = EVENT_CATALOG.filter((entry) => entry.implementedIn !== null).map(
      (entry) => entry.eventType
    );
    expect(implemented.sort()).toEqual([
      'access.grant.changed',
      // Wave 6 publishes `additional-work.requested` and
      // `customer-approval.recorded`, both owner `wo`. Both were reserved with
      // `implementedIn: null` in Wave 3 and now have producers on the request path.
      'additional-work.requested',
      // P1-18 publishes `appointment.changed`, `vehicle.checked-in` and
      // `reception.approved` from `src/modules/reception`. The first two were
      // reserved with `implementedIn: null` since P1-13 and now have producers;
      // `reception.approved` is newly registered. Reception-to-work-order
      // conversion deliberately publishes nothing — the approved catalog defines
      // no event for that fact.
      'appointment.changed',
      'business-partner.created',
      'business-partner.merged',
      'consent.changed',
      // The aggregate is the APPROVAL row, which is immutable — so its version is
      // and stays 1, and `uq_customer_approvals_active` means the fact happens at
      // most once per request.
      'customer-approval.recorded',
      // Wave 7. Owner `dia`, and the only event this phase publishes from the
      // diagnostics module: completion is the fact closure blocker B4 waits for.
      'diagnostic-report.completed',
      'document.link.changed',
      'document.version.registered',
      // Wave 5 also publishes `job.assigned`. Its owner is `wo` and not `tech`
      // because the assignment row lives in `wo.job_assignments` and is written by
      // the work-order module; `buildEventEnvelope` refuses a producer whose leading
      // segment differs from the owner, so `tech` would have made the write throw.
      'job.assigned',
      // P1-19 publishes from `src/modules/work-order`: `work-order.state-changed`
      // and `work-order.closed` in Wave 4, `job.state-changed` in Wave 5. Closure
      // is a separate name from the generic state change because closure is the
      // fact billing, warranty and reporting wait for. `work-order.created` stays
      // reserved: the only creation path is reception's conversion, which the
      // approved catalog gives no event, and the rework path arrives in Wave 8.
      'job.state-changed',
      'labor.session-changed',
      'message-template.version.changed',
      'message.enqueued',
      'organization.branch.status.changed',
      // Wave 8. Owner `qms`: finalization is what closure blocker B5 reads, and a
      // rework link is what B6 reads — the two facts the closure gate waits on.
      'quality-control.finalized',
      'reception.approved',
      'rework.linked',
      'session.revoked',
      'user.invited',
      'user.status.changed',
      'vehicle.checked-in',
      // P1-17 publishes `vehicle.created`, `vehicle.merged`, and
      // `vehicle.relationship.changed` from `src/modules/vehicle`.
      'vehicle.created',
      'vehicle.merged',
      'vehicle.relationship.changed',
      'work-order.closed',
      'work-order.state-changed',
    ]);

    // A phase may own more than one module: P1-18 delivers appointment and
    // reception together, because the frozen Phase 1-8 database splits them into
    // two schemas that one check-in transaction spans.
    const OWNERS_BY_PHASE: Readonly<Record<string, readonly string[]>> = {
      'P1-14': ['iam'],
      'P1-15': ['shared'],
      'P1-16': ['crm'],
      'P1-17': ['veh'],
      'P1-18': ['apt', 'rec'],
      // P1-19 spans four schemas and publishes from TWO of them: `wo` (Waves 4–6)
      // and `dia` (Wave 7's `diagnostic-report.completed`). The job assignment and
      // job state events are owner `wo` and not `tech`, because the rows live in
      // `wo.job_assignments` and `wo.jobs` and are written by the work-order module —
      // `buildEventEnvelope` refuses a producer whose leading segment differs from the
      // owner, so `tech` there would have made the real write path throw.
      //
      // All four schemas now publish: `wo` (Waves 4–6), `dia` (Wave 7) and `qms`
      // (Wave 8). `tech` publishes `labor.session-changed`, whose owner is `tech`
      // because the row lives in `tech.labor_sessions`.
      'P1-19': ['wo', 'tech', 'dia', 'qms'],
    };
    for (const entry of EVENT_CATALOG) {
      if (!implemented.includes(entry.eventType)) continue;
      const phase = entry.implementedIn as string;
      expect(OWNERS_BY_PHASE[phase], `${entry.eventType} phase ${phase}`).toBeDefined();
      expect(OWNERS_BY_PHASE[phase]).toContain(entry.owner);
    }
  });

  it('refuses a producer from a module that does not own the event', () => {
    // The catalog's `owner` column is enforced, not documentary: two modules
    // publishing one name would make the name's meaning ambiguous.
    expect(() =>
      buildEventEnvelope({ ...VALID, eventType: 'access.grant.changed', producer: 'crm' })
    ).toThrow(/may not publish/);
    expect(() =>
      buildEventEnvelope({ ...VALID, eventType: 'access.grant.changed', producer: 'iam.whatever' })
    ).not.toThrow();
  });

  it('finds a registered event and reports an unregistered one as undefined', () => {
    expect(findEvent('access.grant.changed')?.code).toBe('EVT-IAM-001');
    expect(findEvent('invented.event')).toBeUndefined();
  });
});
