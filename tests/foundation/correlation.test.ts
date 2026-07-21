/**
 * Protects the rule that an inbound correlation ID is a *proposal*, never a value.
 *
 * Echoing an unvalidated header into a log line is how log forging starts, and
 * echoing it into a response header is how header injection starts. The strict
 * UUID gate is only a control if the rejection path is proven for the shapes an
 * attacker actually sends — a newline payload, a traversal fragment, an oversized
 * string — so those are asserted individually rather than as one "invalid" case.
 */
import { describe, it, expect } from 'vitest';
import {
  CAUSATION_HEADER,
  CORRELATION_HEADER,
  isValidCorrelationId,
  newCorrelationId,
  normalizeInboundCausationId,
  normalizeInboundCorrelationId,
} from '@/server/observability/correlation';

const VALID_UUID = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Inbound values that must never be adopted, each a real injection shape. */
const HOSTILE_INBOUND: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'newline injection', value: `${VALID_UUID}\nseverity=info msg="forged record"` },
  { label: 'carriage-return injection', value: `${VALID_UUID}\r\nSet-Cookie: a=b` },
  { label: 'path traversal', value: '../../etc/passwd' },
  { label: 'oversized string', value: 'a'.repeat(5_000) },
  { label: 'non-UUID token', value: 'not-a-uuid' },
  { label: 'empty string', value: '' },
  { label: 'whitespace-padded UUID', value: ` ${VALID_UUID} ` },
  { label: 'nil UUID (no version nibble)', value: '00000000-0000-0000-0000-000000000000' },
  { label: 'SQL fragment', value: "1' OR '1'='1" },
];

describe('correlation header names', () => {
  it('are lower-case, which is how Headers.get() normalises them', () => {
    expect(CORRELATION_HEADER).toBe('x-correlation-id');
    expect(CAUSATION_HEADER).toBe('x-causation-id');
  });
});

describe('inbound correlation ID normalisation', () => {
  it('accepts a canonical UUID and reports the acceptance', () => {
    const result = normalizeInboundCorrelationId(VALID_UUID);
    expect(result.correlationId).toBe(VALID_UUID);
    expect(result.inboundAccepted).toBe(true);
  });

  it('lower-cases an accepted upper-case UUID so the ID is canonical downstream', () => {
    const result = normalizeInboundCorrelationId(VALID_UUID.toUpperCase());
    expect(result.correlationId).toBe(VALID_UUID);
    expect(result.inboundAccepted).toBe(true);
  });

  it.each(HOSTILE_INBOUND)('replaces $label with a fresh ID', ({ value }) => {
    const result = normalizeInboundCorrelationId(value);
    expect(result.inboundAccepted).toBe(false);
    expect(result.correlationId).not.toBe(value);
    expect(result.correlationId).toMatch(UUID_SHAPE);
    // The rejected payload must not survive anywhere inside the adopted value.
    expect(result.correlationId).not.toContain('\n');
    expect(result.correlationId).not.toContain('\r');
  });

  it('replaces an absent header rather than leaving the request untraceable', () => {
    for (const absent of [null, undefined]) {
      const result = normalizeInboundCorrelationId(absent);
      expect(result.inboundAccepted).toBe(false);
      expect(result.correlationId).toMatch(UUID_SHAPE);
    }
  });

  it('mints a distinct ID per rejected request', () => {
    const first = normalizeInboundCorrelationId('not-a-uuid');
    const second = normalizeInboundCorrelationId('not-a-uuid');
    expect(first.correlationId).not.toBe(second.correlationId);
  });
});

describe('inbound causation ID normalisation', () => {
  it('accepts and lower-cases a valid UUID', () => {
    expect(normalizeInboundCausationId(VALID_UUID.toUpperCase())).toBe(VALID_UUID);
  });

  it('returns null rather than inventing a causal ancestor', () => {
    for (const { value } of HOSTILE_INBOUND) {
      expect(normalizeInboundCausationId(value)).toBeNull();
    }
    expect(normalizeInboundCausationId(null)).toBeNull();
    expect(normalizeInboundCausationId(undefined)).toBeNull();
  });
});

describe('correlation ID validation and generation', () => {
  it('accepts only canonical UUID strings', () => {
    expect(isValidCorrelationId(VALID_UUID)).toBe(true);
    expect(isValidCorrelationId(123)).toBe(false);
    expect(isValidCorrelationId({ toString: () => VALID_UUID })).toBe(false);
    expect(isValidCorrelationId(`${VALID_UUID}extra`)).toBe(false);
  });

  it('generates IDs that satisfy its own validator and do not repeat', () => {
    const generated = Array.from({ length: 64 }, () => newCorrelationId());
    for (const id of generated) expect(isValidCorrelationId(id)).toBe(true);
    expect(new Set(generated).size).toBe(generated.length);
  });
});
