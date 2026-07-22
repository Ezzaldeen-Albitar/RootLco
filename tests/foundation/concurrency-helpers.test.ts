/**
 * Protects the optimistic-concurrency edge: the header parse and the row-count
 * verdict.
 *
 * `If-Match` arrives in three shapes from real clients (`7`, `"7"`, `W/"7"`) and
 * a parser that accepts only one of them turns a correct client into a 428 loop.
 * More importantly, `assertVersionMatched` must treat zero affected rows as a
 * *conflict* and never as "not found": distinguishing the two would let a caller
 * probe for the existence of rows outside its own scope, which is the exact
 * information the tenant boundary exists to withhold.
 */
import { describe, it, expect } from 'vitest';
import {
  IF_MATCH_HEADER,
  assertVersionMatched,
  parseIfMatch,
  toETag,
  versionGuardFragment,
} from '@/server/db/concurrency';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';

function headers(value?: string): Headers {
  return value === undefined ? new Headers() : new Headers({ [IF_MATCH_HEADER]: value });
}

function captureFailure(run: () => unknown): AppFailure {
  try {
    run();
  } catch (error) {
    if (isAppFailure(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw an AppFailure');
}

describe('parseIfMatch', () => {
  it.each([
    { label: 'bare integer', value: '7' },
    { label: 'quoted ETag', value: '"7"' },
    { label: 'weak ETag', value: 'W/"7"' },
    { label: 'surrounding whitespace', value: '  7  ' },
  ])('accepts the $label form', ({ value }) => {
    expect(parseIfMatch(headers(value), true)).toBe(7);
  });

  it('returns null when the header is absent and the operation does not require it', () => {
    expect(parseIfMatch(headers(), false)).toBeNull();
  });

  it('throws ERR-CON-002 when the header is absent and the operation requires it', () => {
    const failure = captureFailure(() => parseIfMatch(headers(), true));
    expect(failure.code).toBe('ERR-CON-002');
    expect(failure.status).toBe(428);
  });

  it.each([
    { label: 'non-numeric', value: 'abc' },
    { label: 'zero', value: '0' },
    { label: 'negative', value: '-1' },
    { label: 'fractional', value: '1.5' },
    { label: 'empty quotes', value: '""' },
    { label: 'wildcard', value: '*' },
    { label: 'numeric with trailing text', value: '7-stale' },
  ])('throws ERR-CON-002 for a $label value', ({ value }) => {
    expect(captureFailure(() => parseIfMatch(headers(value), false)).code).toBe('ERR-CON-002');
    expect(captureFailure(() => parseIfMatch(headers(value), true)).code).toBe('ERR-CON-002');
  });

  it('never echoes the malformed header value back to the caller', () => {
    const failure = captureFailure(() => parseIfMatch(headers('canary-if-match-value'), true));
    expect(JSON.stringify(failure.safeDetails)).not.toContain('canary-if-match-value');
  });
});

describe('assertVersionMatched', () => {
  it('throws ERR-CON-001 when the guarded UPDATE affected no row', () => {
    const failure = captureFailure(() => assertVersionMatched(0));
    expect(failure.code).toBe('ERR-CON-001');
    expect(failure.status).toBe(409);
  });

  it('treats a null row count as zero, because a driver may report either', () => {
    expect(captureFailure(() => assertVersionMatched(null)).code).toBe('ERR-CON-001');
  });

  it('passes when exactly one row was updated', () => {
    expect(() => assertVersionMatched(1)).not.toThrow();
  });

  it('does not disclose whether the row exists or the version was stale', () => {
    const failure = captureFailure(() => assertVersionMatched(0));
    // Nothing caller-visible distinguishes the two causes.
    expect(failure.safeDetails).toEqual({});
  });
});

describe('ETag rendering and the guard fragment', () => {
  it('renders a record version as a strong ETag that parseIfMatch accepts back', () => {
    expect(toETag(1)).toBe('"1"');
    expect(toETag(42)).toBe('"42"');
    expect(parseIfMatch(headers(toETag(42)), true)).toBe(42);
  });

  it('increments in the SET clause and binds the expected version in the predicate', () => {
    expect(versionGuardFragment(4)).toEqual({
      setClause: 'record_version = record_version + 1',
      predicate: 'record_version = $4',
    });
  });
});
