/**
 * Boundary validation (P1-13-BE-006).
 *
 * Zod parses params, query, and body at the edge. Nothing unparsed reaches an
 * application service, so a service can state its input type and mean it.
 *
 * The mapping to `ERR-VAL-001` returns **path + stable rule code only**. It
 * never echoes the submitted value: validation errors are the most commonly
 * logged and most commonly displayed error class, and echoing input is how a
 * password typed into the wrong field ends up in a log index and on a screen.
 */
import { z, type ZodType } from 'zod';
import { AppFailure, type FieldViolation } from '../errors/app-failure';

/** Converts Zod issues into caller-safe violations. */
export function toViolations(error: z.ZodError, prefix: string): readonly FieldViolation[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map((segment) => String(segment))].join('.'),
    // `issue.code` is Zod's stable machine code (`invalid_type`, `too_small`, …).
    rule: issue.code,
  }));
}

/** Parses a value, throwing `ERR-VAL-001` with field-level violations. */
export function parseOrFail<T>(schema: ZodType<T>, value: unknown, prefix: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppFailure('ERR-VAL-001', {
    message: `Validation failed for ${prefix}`,
    safeDetails: { violations: toViolations(result.error, prefix) },
  });
}

/**
 * Parses `URLSearchParams` into a **null-prototype** object before validation.
 *
 * The accumulator is `Object.create(null)`, not `{}`, and the difference is not
 * stylistic. Query-string names are attacker-chosen and are written straight
 * into this object, which put three distinct defects in one line
 * (`js/remote-property-injection`). All three are measured, not theorised:
 *
 *  1. **Zod reads inherited properties.** Against a plain `{}`, a polluted
 *     `Object.prototype.role` parses as a *validated* `role` field — the schema
 *     reports success and the route receives a value no client ever sent.
 *     Twenty-plus list endpoints build their query object here, and several
 *     validate authorization-shaped fields, so a single prototype write
 *     anywhere in the process would inject them everywhere at once. A
 *     null-prototype object inherits nothing and is immune by construction.
 *  2. **The object's own prototype was writable.** `?__proto__=a&__proto__=b`
 *     yields an array value, and the `__proto__` setter accepts objects, so the
 *     accumulator's prototype became that array. `Object.prototype` itself was
 *     never reachable this way — the honest scope is object-local — but a
 *     request should not be able to reshape the object validating it.
 *  3. **A parameter named `__proto__` was silently dropped.** On a plain `{}`
 *     the assignment hits the setter instead of creating a key, so
 *     `Object.keys()` is empty and the field never reaches Zod: no value, no
 *     error, nothing to debug. It is now an ordinary own key.
 *
 * A `Map` would be safer still but would change the public contract — every
 * caller passes this result directly to `parseOrFail`, and Zod expects an
 * object. `Object.create(null)` keeps that contract exactly: spread,
 * `JSON.stringify`, `Object.entries` and `safeParse` all behave identically.
 *
 * ## Why `__proto__` is omitted rather than stored — or thrown on
 *
 * A null prototype alone would have RELOCATED defect 2 rather than removed it.
 * On a null-prototype object `__proto__` becomes a live own enumerable key, and
 * the value travels: `Object.assign({}, query)` or a `for…in` copy writes it
 * into a target that *does* have `Object.prototype`, re-arming the setter and
 * reshaping **that** object instead. Measured — the copied target's prototype
 * becomes the array, and it survives a `JSON.parse(JSON.stringify(…))` round
 * trip. Before the change no `__proto__` key existed at all, so the anomaly
 * died with the object. Storing it would turn a self-contained problem into a
 * portable one, even though no caller copies this object today.
 *
 * An earlier version of this fix **threw** instead, so a client naming the field
 * got a real error rather than silence. That was wrong, and an adversarial
 * review caught it: **eight routes call this function lexically BEFORE
 * `handleOperation`**, so the `AppFailure` escaped the pipeline's try/catch and
 * became an unhandled 500 rather than a 422 problem document — reachable by any
 * caller, on endpoints that are otherwise unauthenticated-safe. Turning a
 * dropped parameter into a caller-triggerable server error is a worse trade
 * than the silence it was meant to fix, and it is the same defect class this
 * initiative fixed in `idempotency.ts` a few commits earlier.
 *
 * So the key is simply not copied. This function stays **total** — it is called
 * outside an error boundary and must never throw. The omission is deliberate
 * and is the weakest of the three defects: `__proto__` is not a field any
 * schema can consume (Zod accepts the key in a shape but silently discards it
 * from the parsed output), so a caller naming it gets the same outcome an
 * unknown parameter gets everywhere else.
 *
 * `constructor` and `prototype` are NOT omitted: they are ordinary own keys with
 * no setter behaviour, they shadow nothing that matters on a null-prototype
 * object, and dropping them would silently discard fields a generic form
 * serialiser may legitimately send.
 *
 * The one behaviour that does change: the result has no `Object.prototype`
 * methods, so `result.hasOwnProperty(...)` would throw. No caller does that —
 * every use in `src/` is the safe `Object.prototype.hasOwnProperty.call(…)`
 * form — and a test pins it.
 */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out = Object.create(null) as Record<string, string | string[]>;
  for (const key of new Set(params.keys())) {
    // Not copied, and not thrown on. See the note above: this function is
    // called outside the route pipeline's error boundary, so throwing here
    // produces an unhandled 500 instead of a validation failure.
    if (key === '__proto__') continue;
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? '');
  }
  return out;
}

/**
 * Reads and parses a JSON body.
 *
 * A body that is not JSON is `ERR-REQ-001` (malformed request), not
 * `ERR-VAL-001` (validation) — the distinction matters to a client, which can
 * fix the second by changing a field and the first only by fixing its encoder.
 */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new AppFailure('ERR-REQ-001', {
      message: `Unsupported content type for a JSON endpoint`,
    });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppFailure('ERR-REQ-001', { message: 'Request body is not valid JSON' });
  }
  return parseOrFail(schema, raw, 'body');
}

/**
 * Shared scalar schemas. Centralised so "what is a money value" has exactly one
 * answer across eleven backend phases.
 */
export const schemas = {
  uuid: z.string().uuid(),

  /**
   * Money as a decimal STRING plus an ISO-4217 currency code.
   *
   * Never a JavaScript number: IEEE-754 cannot represent 0.1 exactly, and the
   * database stores exact numerics. A string crosses the boundary losslessly and
   * forces every consumer to choose a decimal library deliberately.
   *
   * Scale is not fixed here because minor units differ by currency
   * (`shared.currencies.minor_unit`: USD 2, JOD 3); the domain validates scale
   * against the currency it is working in.
   */
  money: z.object({
    amount: z
      .string()
      .regex(/^-?\d{1,15}(\.\d{1,6})?$/, 'must be a decimal string with at most 6 decimal places'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 alphabetic code'),
  }),

  /** Opaque pagination cursor. Shape is validated when it is decoded. */
  cursor: z.string().min(1).max(512),

  /** Page size. Bounds are enforced again in `resolveLimit()`. */
  limit: z.coerce.number().int().min(1).max(100),
} as const;

export type Money = z.infer<typeof schemas.money>;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Reads a company/branch authorization target out of a not-yet-validated body.
 *
 * A `scope: 'branch'` operation is evaluated with `iam.has_permission`, which is
 * scope-blind, unless the route names the resource it is about; only then does
 * the pipeline use `iam.has_permission_in_scope`. For a creation command the
 * resource does not exist yet, so the target has to come from the request body —
 * which at this point in the pipeline has not been schema-validated.
 *
 * That is safe in this direction and only this direction. The target can make
 * authorization STRICTER (a grant that does not cover the named branch stops
 * applying) and can never make it looser: omitting or malforming either field
 * simply yields no target, leaving the pre-existing scope-blind evaluation, and
 * the body schema then refuses the request. Both fields are required together
 * because a company without its branch would narrow to the wrong level.
 */
export function scopeTargetOption(body: unknown): {
  authorizationTarget?: { companyId: string; branchId: string };
} {
  if (typeof body !== 'object' || body === null) return {};
  const { companyId, branchId } = body as Record<string, unknown>;
  if (typeof companyId !== 'string' || !UUID.test(companyId)) return {};
  if (typeof branchId !== 'string' || !UUID.test(branchId)) return {};
  // Spread rather than an explicit `undefined`: `exactOptionalPropertyTypes` is
  // on, so an absent target must be an absent KEY, not a key holding undefined.
  return { authorizationTarget: { companyId, branchId } };
}
