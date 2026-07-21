/**
 * Protects the one-way boundary between an internal fault and what a caller sees.
 *
 * The catalog and the problem renderer are only worth having if a developer
 * cannot leak through them by accident: `problemFor()` reads `safeDetails` and
 * nothing else, so a message, a cause, or a stack trace must be structurally
 * unreachable rather than merely "not currently included". These tests assert the
 * absence, because absence is exactly the property that silently regresses when
 * someone adds a convenience field to the renderer.
 */
import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  allErrorDefinitions,
  errorDefinition,
  isErrorCode,
  type ErrorCode,
} from '@/server/errors/catalog';
import { AppFailure, isAppFailure, toAppFailure } from '@/server/errors/app-failure';
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE_PREFIX,
  problemFor,
  problemHeaders,
} from '@/server/errors/problem';
import { CORRELATION_HEADER } from '@/server/observability/correlation';

/** Fields RFC 9457 rendering is allowed to expose. Anything else is a leak. */
const DOCUMENTED_PROBLEM_FIELDS = [
  'type',
  'title',
  'status',
  'code',
  'correlationId',
  'violations',
  'retryAfterSeconds',
  'contract',
  'requiredPermissions',
];

const CORRELATION_ID = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';

describe('error catalog coverage', () => {
  it('defines every registered code exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) {
      const definition = errorDefinition(code);
      expect(definition.code).toBe(code);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThan(600);
      expect(typeof definition.retryable).toBe('boolean');
    }
  });

  it('exposes the whole catalog through allErrorDefinitions()', () => {
    const definitions = allErrorDefinitions();
    expect(definitions.map((definition) => definition.code)).toEqual([...ERROR_CODES]);
  });

  it('recognises registered codes and rejects invented ones', () => {
    expect(isErrorCode('ERR-SYS-001')).toBe(true);
    expect(isErrorCode('ERR-NOPE-999')).toBe(false);
    // An inherited property name must not be mistaken for a registration.
    expect(isErrorCode('toString')).toBe(false);
  });
});

describe('problem document rendering', () => {
  it('exposes only the documented fields and never the developer message, cause, or stack', () => {
    const developerMessage =
      'internal-only: pool connection to 10.0.0.5 refused while reading crm.business_partners';
    const cause = new Error('driver: relation "crm.business_partners" does not exist');
    const failure = new AppFailure('ERR-VAL-001', {
      message: developerMessage,
      cause,
      safeDetails: { violations: [{ path: 'body.name', rule: 'too_small' }] },
    });

    const problem = problemFor(failure, CORRELATION_ID);
    const serialized = JSON.stringify(problem);

    for (const key of Object.keys(problem)) {
      expect(DOCUMENTED_PROBLEM_FIELDS).toContain(key);
    }
    expect(serialized).not.toContain('internal-only');
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).not.toContain('driver:');
    expect(serialized).not.toContain('message');
    expect(serialized).not.toContain('cause');
    expect(serialized).not.toContain('stack');
    expect(problem.violations).toEqual([{ path: 'body.name', rule: 'too_small' }]);
  });

  it('renders a URN type for every catalog code', () => {
    for (const code of ERROR_CODES) {
      const problem = problemFor(new AppFailure(code), CORRELATION_ID);
      expect(problem.type).toBe(`${PROBLEM_TYPE_PREFIX}${code}`);
      expect(problem.type.startsWith('urn:rootlco:error:')).toBe(true);
      expect(problem.code).toBe(code);
      expect(problem.status).toBe(errorDefinition(code).status);
      expect(problem.title).toBe(errorDefinition(code).title);
      expect(problem.correlationId).toBe(CORRELATION_ID);
    }
  });

  it('omits optional fields that the failure did not declare', () => {
    const problem = problemFor(new AppFailure('ERR-RES-001'), CORRELATION_ID);
    expect(Object.keys(problem).sort()).toEqual([
      'code',
      'correlationId',
      'status',
      'title',
      'type',
    ]);
  });

  it('carries safe authorization and stub metadata when the failure declares it', () => {
    const problem = problemFor(
      new AppFailure('ERR-IAM-001', {
        safeDetails: { requiredPermissions: ['crm.partner.read'] },
      }),
      CORRELATION_ID
    );
    expect(problem.requiredPermissions).toEqual(['crm.partner.read']);

    const stub = problemFor(
      new AppFailure('ERR-STB-001', { safeDetails: { contract: 'FileService' } }),
      CORRELATION_ID
    );
    expect(stub.contract).toBe('FileService');
  });
});

describe('problem headers', () => {
  it('always carries the media type, correlation ID, and no-store', () => {
    const headers = problemHeaders(new AppFailure('ERR-RES-001'), CORRELATION_ID);
    expect(headers['Content-Type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(headers[CORRELATION_HEADER]).toBe(CORRELATION_ID);
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('sets Retry-After only when the failure declares retryAfterSeconds', () => {
    const withoutRetry = problemHeaders(new AppFailure('ERR-RES-001'), CORRELATION_ID);
    expect(withoutRetry['Retry-After']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(withoutRetry, 'Retry-After')).toBe(false);

    const withRetry = problemHeaders(
      new AppFailure('ERR-RTE-001', { safeDetails: { retryAfterSeconds: 2.4 } }),
      CORRELATION_ID
    );
    // Rounded up: telling a client to retry before the window resets is worse
    // than telling it to wait one second longer.
    expect(withRetry['Retry-After']).toBe('3');

    const zeroRetry = problemHeaders(
      new AppFailure('ERR-RTE-001', { safeDetails: { retryAfterSeconds: 0 } }),
      CORRELATION_ID
    );
    expect(zeroRetry['Retry-After']).toBe('0');
  });
});

describe('unknown-throw classification', () => {
  it('wraps a foreign Error as ERR-SYS-001 and retains the cause for logging', () => {
    const original = new TypeError('undefined is not a function');
    const failure = toAppFailure(original);

    expect(isAppFailure(failure)).toBe(true);
    expect(failure.code).toBe('ERR-SYS-001');
    expect(failure.status).toBe(500);
    expect(failure.cause).toBe(original);
    expect(failure.message).toBe('undefined is not a function');
    // The retained cause must not become visible to a caller.
    expect(JSON.stringify(problemFor(failure, CORRELATION_ID))).not.toContain('not a function');
  });

  it('wraps a non-Error throw without echoing its content', () => {
    const thrown = { secretish: 'value that must not become a message' };
    const failure = toAppFailure(thrown);

    expect(failure.code).toBe('ERR-SYS-001');
    expect(failure.message).toBe('Non-Error value thrown');
    expect(failure.cause).toBe(thrown);
  });

  it('passes an existing AppFailure through unchanged', () => {
    const failure = new AppFailure('ERR-CON-001');
    expect(toAppFailure(failure)).toBe(failure);
  });

  it('defaults an AppFailure message to the catalog title and safeDetails to empty', () => {
    const code: ErrorCode = 'ERR-CTX-001';
    const failure = new AppFailure(code);
    expect(failure.message).toBe(errorDefinition(code).title);
    expect(failure.safeDetails).toEqual({});
    expect(failure.name).toBe('AppFailure');
    expect(failure.cause).toBeUndefined();
  });
});
