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

/** Parses `URLSearchParams` into a plain object before validation. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
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
