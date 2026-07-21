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
      // P1-13 reserves names only; nothing claims an implementation yet.
      expect(entry.implementedIn).toBeNull();
    }
  });

  it('finds a registered event and reports an unregistered one as undefined', () => {
    expect(findEvent('access.grant.changed')?.code).toBe('EVT-IAM-001');
    expect(findEvent('invented.event')).toBeUndefined();
  });
});
