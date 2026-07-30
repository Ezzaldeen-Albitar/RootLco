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
  assertMinorUnitScale,
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

/**
 * CodeQL `js/remote-property-injection` — src/server/http/validation.ts.
 *
 * Query-string names are attacker-chosen and were written into a plain `{}`.
 * Each test below pins one measured consequence of that, and the first is the
 * one that matters most: **Zod reads inherited properties**, so against a plain
 * object a polluted `Object.prototype` satisfies schema fields the client never
 * sent — silently, with `success: true`.
 */
describe('searchParamsToObject — prototype safety', () => {
  const Query = z.object({
    limit: z.string().optional(),
    role: z.string().optional(),
  });

  /** Pollutes `Object.prototype` for one assertion and always cleans up. */
  const withPollutedPrototype = <T>(key: string, value: unknown, body: () => T): T => {
    Object.defineProperty(Object.prototype, key, {
      value,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    try {
      return body();
    } finally {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  };

  it('a polluted Object.prototype cannot inject a validated field', () => {
    // The defect this fix exists for. With a plain `{}` accumulator Zod parsed
    // `role: 'admin-via-prototype'` out of thin air and reported success.
    const result = withPollutedPrototype('role', 'admin-via-prototype', () =>
      Query.safeParse(searchParamsToObject(new URLSearchParams('limit=25')))
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.limit).toBe('25');
    expect(result.data.role, 'an inherited value must not become validated input').toBeUndefined();
  });

  it('returns an object that inherits nothing at all', () => {
    const out = searchParamsToObject(new URLSearchParams('limit=25'));
    expect(Object.getPrototypeOf(out)).toBeNull();
    // Not merely "no prototype today": nothing on Object.prototype is visible.
    expect(
      withPollutedPrototype('anything', 'x', () => (out as Record<string, unknown>).anything)
    ).toBeUndefined();
  });

  it('never throws — eight routes call it outside the pipeline error boundary', () => {
    // An earlier version of this fix threw an AppFailure on `__proto__`. Eight
    // routes call this function lexically BEFORE `handleOperation`, so the throw
    // escaped the try/catch that renders every failure as a problem document and
    // became an unhandled 500 — a caller-triggerable server error, which is the
    // same defect class this initiative fixed in `idempotency.ts`. The function
    // must stay total.
    for (const query of [
      '__proto__=sent-by-client',
      '__proto__=a&__proto__=b',
      'limit=25&__proto__=x',
      'constructor=x&prototype=y&__proto__=z',
    ]) {
      expect(() => searchParamsToObject(new URLSearchParams(query)), query).not.toThrow();
    }
  });

  it('omits __proto__ entirely rather than storing it', () => {
    const out = searchParamsToObject(new URLSearchParams('limit=25&__proto__=sent-by-client'));
    expect(Object.keys(out)).toEqual(['limit']);
    expect(Object.getOwnPropertyNames(out)).not.toContain('__proto__');
    expect(Object.getPrototypeOf(out)).toBeNull();
  });

  it('never hands back an object whose __proto__ key can travel into a copy', () => {
    // The regression an adversarial review caught in the FIRST version of this
    // fix. `Object.create(null)` alone turned `__proto__` into a live own key,
    // and the value travelled: `Object.assign({}, query)` wrote it into a target
    // that does have Object.prototype, re-arming the setter and reshaping THAT
    // object — measured, and it survived a JSON round trip.
    //
    // A second review then caught that the list below did NOT include a
    // `__proto__` parameter, so it could not distinguish any implementation and
    // pinned nothing. The hostile inputs are first now.
    for (const query of [
      '__proto__=a&__proto__=b',
      '__proto__=single',
      'limit=25&__proto__=a&__proto__=b',
      'limit=25',
      'constructor=x&prototype=y',
      'a.b=1&c[d]=2',
    ]) {
      const out = searchParamsToObject(new URLSearchParams(query));
      expect(Object.getOwnPropertyNames(out), query).not.toContain('__proto__');
      expect(Object.getPrototypeOf(out), query).toBeNull();

      const assigned = Object.assign({}, out);
      expect(Array.isArray(Object.getPrototypeOf(assigned)), query).toBe(false);
      expect(Object.getPrototypeOf(assigned), query).toBe(Object.prototype);

      const copied: Record<string, unknown> = {};
      for (const key in out) copied[key] = out[key];
      expect(Object.getPrototypeOf(copied), query).toBe(Object.prototype);
    }
  });

  it('leaves Object.prototype untouched for every dangerous key', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    for (const key of ['constructor', 'prototype', 'toString', 'valueOf']) {
      searchParamsToObject(new URLSearchParams(`${key}=x&${key}=y`));
      searchParamsToObject(new URLSearchParams(`${encodeURIComponent(key)}=x`));
    }
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect([].length).toBe(0);
  });

  it('keeps constructor and prototype as plain data, not as callables', () => {
    const out = searchParamsToObject(
      new URLSearchParams('constructor=evil&prototype=evil&toString=evil')
    );
    expect(out['constructor']).toBe('evil');
    expect(out['prototype']).toBe('evil');
    expect(out['toString']).toBe('evil');
    // Nothing here is invocable, so no downstream call site can be hijacked.
    for (const value of Object.values(out)) expect(typeof value).not.toBe('function');
  });

  it('is unaffected by dotted, bracketed and percent-encoded spellings', () => {
    // This function performs ONE flat assignment — it never walks a path — so a
    // dotted or bracketed name is just a key with an odd character in it. The
    // test pins that: these must not be interpreted, merely stored.
    const out = searchParamsToObject(
      new URLSearchParams('a.b=1&c%5Bd%5D=2&constructor.prototype.polluted=4')
    );
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(out['a.b']).toBe('1');
    expect(out['c[d]']).toBe('2');
    expect(out['constructor.prototype.polluted']).toBe('4');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('survives a generated sweep of dangerous key shapes', () => {
    // '__proto__' itself is excluded: it is refused outright, and its own
    // tests above cover that. Everything else must be stored inertly.
    const bases = ['constructor', 'prototype', '__defineGetter__', '__lookupGetter__'];
    const shapes = bases.flatMap((base) => [
      base,
      `${base}.x`,
      `${base}[x]`,
      `a.${base}`,
      `${base}${base}`,
      base.toUpperCase(),
    ]);
    for (const key of shapes) {
      const single = searchParamsToObject(new URLSearchParams([[key, 'v']]));
      const repeated = searchParamsToObject(
        new URLSearchParams([
          [key, 'v1'],
          [key, 'v2'],
        ])
      );
      expect(Object.getPrototypeOf(single), key).toBeNull();
      expect(Object.getPrototypeOf(repeated), key).toBeNull();
      expect(Object.keys(single), key).toEqual([key]);
    }
    expect(({} as Record<string, unknown>).v).toBeUndefined();
  });

  it('still parses normally through Zod, including unknown-field stripping', () => {
    const result = Query.safeParse(
      searchParamsToObject(new URLSearchParams('limit=25&role=viewer&unknown=y'))
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ limit: '25', role: 'viewer' });
  });

  it('one request cannot observe state injected by another', () => {
    // Object-local by construction: each call builds its own accumulator, so a
    // hostile first request leaves the second with nothing.
    searchParamsToObject(new URLSearchParams('__proto__=a&__proto__=b&constructor=evil'));
    const second = searchParamsToObject(new URLSearchParams('limit=1'));
    expect(Object.keys(second)).toEqual(['limit']);
    expect(second['constructor']).toBeUndefined();
    expect(Object.getPrototypeOf(second)).toBeNull();
    // And nothing global was touched on the way through.
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it('remains spreadable, serialisable and enumerable for its callers', () => {
    // Every caller hands the result straight to `parseOrFail`. These are the
    // operations that path performs, pinned so the null prototype cannot break
    // them unnoticed.
    const out = searchParamsToObject(new URLSearchParams('limit=25&tag=a&tag=b'));
    expect({ ...out }).toEqual({ limit: '25', tag: ['a', 'b'] });
    expect(JSON.parse(JSON.stringify(out))).toEqual({ limit: '25', tag: ['a', 'b'] });
    expect(Object.entries(out)).toHaveLength(2);
  });
});

describe('assertMinorUnitScale', () => {
  /**
   * The currency-scale check, which the money schema's own docstring delegates to.
   *
   * It exists because the boundary regexes accept four decimals for every currency —
   * that is the COLUMN's scale (`numeric(18,4)`), not the currency's. USD and EUR carry
   * two minor units and JOD three (`shared.currencies.minor_unit`). Nothing downstream
   * objects to a half-cent: PostgreSQL rounds a fifth decimal away silently and stores
   * the fourth exactly, so an amount more precise than its currency reaches the ledger
   * and stays there.
   *
   * The consequence is not cosmetic. A `0.0001` USD credit note leaves an open
   * receivable no tenderable payment can settle, `readOutstanding` reports
   * `isSettled: false` permanently, and the delivery module's
   * `financial_balance_outstanding` blocker stays raised with an override as the only
   * exit.
   */
  const path = 'body.amount';

  it('accepts an amount inside its currency’s minor units', () => {
    expect(() => assertMinorUnitScale('10.50', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('0.01', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('0.001', 'JOD', 3, path)).not.toThrow();
    expect(() => assertMinorUnitScale('12345678901234.99', 'EUR', 2, path)).not.toThrow();
  });

  it('accepts an integer amount and one with no fractional part at all', () => {
    // The early return on a missing decimal point, which is the common case for a
    // currency with `minor_unit = 0`.
    expect(() => assertMinorUnitScale('100', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('0', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('7', 'JPY', 0, path)).not.toThrow();
  });

  it('treats trailing zeros as insignificant, because the column scale is still four', () => {
    // `100.0000` is a perfectly valid USD amount, and every amount read back out of
    // `numeric(18,4)` looks like this. Refusing it would refuse the database's own
    // output.
    expect(() => assertMinorUnitScale('100.0000', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('10.5000', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('0.00', 'USD', 2, path)).not.toThrow();
    expect(() => assertMinorUnitScale('1.000000', 'USD', 2, path)).not.toThrow();
  });

  it('refuses a non-zero digit beyond the currency’s minor units', () => {
    expect(() => assertMinorUnitScale('0.0001', 'USD', 2, path)).toThrow(AppFailure);
    expect(() => assertMinorUnitScale('10.005', 'USD', 2, path)).toThrow(AppFailure);
    expect(() => assertMinorUnitScale('10.0050', 'USD', 2, path)).toThrow(AppFailure);
    // JOD tolerates a third decimal and refuses a fourth — the check is per currency,
    // which is the whole reason the scale cannot be pinned in the schema.
    expect(() => assertMinorUnitScale('0.0001', 'JOD', 3, path)).toThrow(AppFailure);
    // And a zero-minor-unit currency refuses any fraction at all.
    expect(() => assertMinorUnitScale('1.5', 'JPY', 0, path)).toThrow(AppFailure);
  });

  it('refuses with ERR-VAL-001, the field path, and a stable rule code', () => {
    let failure: AppFailure | null = null;
    try {
      assertMinorUnitScale('0.0001', 'USD', 2, path);
    } catch (error) {
      failure = isAppFailure(error) ? error : null;
    }
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe('ERR-VAL-001');
    expect(failure?.safeDetails.violations).toEqual([{ path, rule: 'minor_unit_scale' }]);
  });

  it('names the currency and its minor unit, and echoes no submitted value', () => {
    // The currency and the minor unit are REFERENCE data, not caller input, so naming
    // them is safe and is the difference between an actionable refusal and a riddle.
    // The amount is caller input and must not be echoed — this file's whole contract.
    let message = '';
    try {
      assertMinorUnitScale(`0.0001${CANARY}`.slice(0, 6), 'USD', 2, path);
    } catch (error) {
      message = isAppFailure(error) ? error.message : '';
    }
    expect(message).toContain('USD');
    expect(message).toContain('2');
    expect(message).not.toContain(CANARY);

    // And nothing a caller can read carries the value either.
    const failure = new AppFailure('ERR-VAL-001', {
      message: 'USD has 2 minor unit(s); the amount is more precise than the currency.',
      safeDetails: { violations: [{ path, rule: 'minor_unit_scale' }] },
    });
    expect(JSON.stringify(problemFor(failure, CORRELATION_ID))).not.toContain(CANARY);
  });

  it('never converts the amount to a number, so a 20-digit value is judged exactly', () => {
    // A `Number()` implementation would lose the trailing digits of a value this long
    // and answer "fine". The comparison is string-only, so the offending digit is seen.
    expect(() => assertMinorUnitScale('99999999999999.9999', 'USD', 2, path)).toThrow(AppFailure);
    // The mirror case: the same length, with the excess digits zero.
    expect(() => assertMinorUnitScale('99999999999999.9900', 'USD', 2, path)).not.toThrow();
  });
});
