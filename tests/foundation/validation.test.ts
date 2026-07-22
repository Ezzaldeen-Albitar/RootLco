/**
 * Protects the "path and rule code, never the value" contract of boundary
 * validation, and the ERR-REQ-001 / ERR-VAL-001 split.
 *
 * Validation errors are the most frequently logged and most frequently displayed
 * error class in the system, so they are the most likely place for a password
 * typed into the wrong field to end up in a log index and on a screen. The test
 * therefore asserts the *absence* of the submitted value in the caller-visible
 * structure, which is the only assertion that fails when someone "improves" the
 * message by including the received input.
 *
 * The status split matters to clients too: a 422 is fixed by changing a field, a
 * 400 only by fixing the encoder.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
  toViolations,
} from '@/server/http/validation';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';
import { problemFor } from '@/server/errors/problem';

const CORRELATION_ID = '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f';

/** A value that must never appear in anything a caller or a log index can read. */
const CANARY = 'canary-value-that-must-never-be-echoed-9f3a';

const ORDER = z.object({
  reference: z.string().min(64),
  items: z.array(z.object({ quantity: z.number().int() })),
});

function captureFailure(run: () => unknown): AppFailure {
  try {
    run();
  } catch (error) {
    if (isAppFailure(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw an AppFailure');
}

describe('parseOrFail', () => {
  it('returns the parsed value on success', () => {
    const parsed = parseOrFail(z.object({ n: z.number() }), { n: 1 }, 'body');
    expect(parsed).toEqual({ n: 1 });
  });

  it('throws ERR-VAL-001 with a dotted path and a stable rule code', () => {
    const failure = captureFailure(() =>
      parseOrFail(ORDER, { reference: CANARY, items: [{ quantity: CANARY }] }, 'body')
    );

    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.status).toBe(422);
    const violations = failure.safeDetails.violations ?? [];
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.map((violation) => violation.path)).toContain('body.reference');
    expect(violations.map((violation) => violation.path)).toContain('body.items.0.quantity');
    for (const violation of violations) {
      // Machine codes, never a localized sentence.
      expect(violation.rule).toMatch(/^[a-z][a-z_]*$/);
    }
    expect(violations.find((violation) => violation.path === 'body.items.0.quantity')?.rule).toBe(
      'invalid_type'
    );
  });

  it('never echoes the submitted value into anything a caller can read', () => {
    const failure = captureFailure(() =>
      parseOrFail(ORDER, { reference: CANARY, items: [{ quantity: CANARY }] }, 'body')
    );

    expect(JSON.stringify(failure.safeDetails)).not.toContain(CANARY);
    expect(JSON.stringify(problemFor(failure, CORRELATION_ID))).not.toContain(CANARY);
    expect(failure.message).not.toContain(CANARY);
  });

  it('prefixes violations with the segment that was validated', () => {
    const failure = captureFailure(() => parseOrFail(z.object({ id: schemas.uuid }), {}, 'params'));
    expect(failure.safeDetails.violations?.[0]?.path).toBe('params.id');
  });

  it('maps raw Zod issues through toViolations without carrying data', () => {
    const result = z.object({ n: z.number() }).safeParse({ n: CANARY });
    expect(result.success).toBe(false);
    if (result.success) return;

    const violations = toViolations(result.error, 'query');
    expect(violations).toEqual([{ path: 'query.n', rule: 'invalid_type' }]);
  });
});

describe('parseJsonBody', () => {
  const schema = z.object({ note: z.string() });

  it('parses a well-formed JSON body', async () => {
    const request = new Request('https://rootlco.invalid/api/v1/meta/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'value' }),
    });

    await expect(parseJsonBody(request, schema)).resolves.toEqual({ note: 'value' });
  });

  it('rejects a non-JSON content type as ERR-REQ-001', async () => {
    const request = new Request('https://rootlco.invalid/api/v1/meta/echo', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'note=value',
    });

    const failure = await parseJsonBody(request, schema).catch((error: unknown) => error);
    expect(isAppFailure(failure)).toBe(true);
    expect((failure as AppFailure).code).toBe('ERR-REQ-001');
    expect((failure as AppFailure).status).toBe(400);
  });

  it('rejects a missing content type rather than guessing', async () => {
    const request = new Request('https://rootlco.invalid/api/v1/meta/echo', { method: 'GET' });

    const failure = await parseJsonBody(request, schema).catch((error: unknown) => error);
    expect((failure as AppFailure).code).toBe('ERR-REQ-001');
  });

  it('rejects a malformed body as ERR-REQ-001, not as a validation failure', async () => {
    const request = new Request('https://rootlco.invalid/api/v1/meta/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"note":',
    });

    const failure = await parseJsonBody(request, schema).catch((error: unknown) => error);
    expect((failure as AppFailure).code).toBe('ERR-REQ-001');
  });

  it('still applies schema validation to a well-formed body', async () => {
    const request = new Request('https://rootlco.invalid/api/v1/meta/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ note: 42 }),
    });

    const failure = await parseJsonBody(request, schema).catch((error: unknown) => error);
    expect((failure as AppFailure).code).toBe('ERR-VAL-001');
    expect((failure as AppFailure).safeDetails.violations?.[0]?.path).toBe('body.note');
  });
});

describe('shared scalar schemas', () => {
  it('accepts money as a decimal string with an ISO-4217 code', () => {
    expect(schemas.money.safeParse({ amount: '10.50', currency: 'USD' }).success).toBe(true);
    expect(schemas.money.safeParse({ amount: '-1234567890.123456', currency: 'JOD' }).success).toBe(
      true
    );
  });

  it('rejects a JavaScript number, because IEEE-754 cannot carry an exact amount', () => {
    const result = schemas.money.safeParse({ amount: 10.5, currency: 'USD' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('invalid_type');
    }
  });

  it('rejects more scale than any currency minor unit could need', () => {
    expect(schemas.money.safeParse({ amount: '1.1234567', currency: 'USD' }).success).toBe(false);
  });

  it('rejects a currency code that is not three upper-case letters', () => {
    expect(schemas.money.safeParse({ amount: '1.00', currency: 'usd' }).success).toBe(false);
    expect(schemas.money.safeParse({ amount: '1.00', currency: 'US' }).success).toBe(false);
  });

  it('bounds the opaque cursor and the page limit', () => {
    expect(schemas.cursor.safeParse('').success).toBe(false);
    expect(schemas.cursor.safeParse('a'.repeat(513)).success).toBe(false);
    expect(schemas.limit.safeParse('25').success).toBe(true);
    expect(schemas.limit.safeParse('0').success).toBe(false);
    expect(schemas.limit.safeParse('101').success).toBe(false);
  });
});

describe('searchParamsToObject', () => {
  it('collapses single values and preserves repeated ones', () => {
    const params = new URLSearchParams('limit=25&tag=a&tag=b&empty=');
    expect(searchParamsToObject(params)).toEqual({ limit: '25', tag: ['a', 'b'], empty: '' });
  });
});
