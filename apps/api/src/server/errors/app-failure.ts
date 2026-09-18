/**
 * `AppFailure` — the only error type the API boundary knows how to render.
 *
 * The split that matters: `message` is developer-facing and goes to logs and
 * error monitoring; `safeDetails` is the ONLY structure that may reach a caller.
 * Anything not deliberately placed in `safeDetails` cannot leak, because
 * `problem.ts` reads nothing else.
 *
 * `cause` is retained for logging but is never serialised into a response.
 */
import { type ErrorCode, errorDefinition } from './catalog';

/** Field-level violation shape used by validation failures. */
export interface FieldViolation {
  /** Dotted path into the request document, e.g. `body.items.0.quantity`. */
  readonly path: string;
  /** Stable machine code (Zod issue code), never a localized sentence. */
  readonly rule: string;
}

/**
 * Which subscription ceiling a write ran into.
 *
 * Safe to publish: the caller is inside the organisation the numbers describe,
 * and the whole point of the code is that an administrator can be told what to
 * do about it. A refusal that says only "capacity" leaves them guessing which
 * of three ceilings they hit and by how much.
 */
export interface CapacityDetail {
  /** `companies`, `branches` or `users`. */
  readonly kind: string;
  /** The ceiling the active plan declares for that kind. */
  readonly limit: number;
  /** What the organisation is consuming against it right now. */
  readonly used: number;
}

/**
 * One capacity kind a plan change would place BELOW what the organisation is
 * already using.
 *
 * `newLimit`, not `limit`: the number is what the plan being assigned would
 * impose, and an operator reading the refusal has to be able to tell it from the
 * ceiling in force. Safe to publish for the same reason the ceiling itself is —
 * the caller is administering the organisation the numbers describe.
 */
export interface CapacityShortfall {
  /** `companies`, `branches` or `users`. */
  readonly kind: string;
  /** What the organisation is consuming right now. */
  readonly used: number;
  /** The ceiling the plan being assigned would impose. */
  readonly newLimit: number;
}

/** Caller-safe extras. Only primitives and the shapes declared here. */
export interface SafeDetails {
  readonly violations?: readonly FieldViolation[];
  /** Seconds until the caller may retry. Throttling only. */
  readonly retryAfterSeconds?: number;
  /** Name of the contract-only service that is not implemented yet. */
  readonly contract?: string;
  /** Permission codes the operation requires. Safe: they are public API metadata. */
  readonly requiredPermissions?: readonly string[];
  /** Which subscription ceiling was reached. Capacity refusals only. */
  readonly capacity?: CapacityDetail;
  /** Every kind a plan change would leave over its ceiling. Plan refusals only. */
  readonly overCapacity?: readonly CapacityShortfall[];
}

export interface AppFailureOptions {
  /** Developer-facing detail for logs. Never returned to a caller. */
  readonly message?: string;
  readonly safeDetails?: SafeDetails;
  readonly cause?: unknown;
}

export class AppFailure extends Error {
  public override readonly name = 'AppFailure';
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly safeDetails: SafeDetails;

  constructor(code: ErrorCode, options: AppFailureOptions = {}) {
    const definition = errorDefinition(code);
    super(options.message ?? definition.title);
    this.code = code;
    this.status = definition.status;
    this.safeDetails = options.safeDetails ?? {};
    if (options.cause !== undefined) {
      // Assigned rather than passed to super(): `exactOptionalPropertyTypes`
      // makes `{ cause: undefined }` a type error, and Error's own `cause`
      // property is optional.
      this.cause = options.cause;
    }
  }
}

/** Narrowing guard used by the boundary renderer and by tests. */
export function isAppFailure(value: unknown): value is AppFailure {
  return value instanceof AppFailure;
}

/**
 * Classifies an unknown throw. Anything that is not already an `AppFailure`
 * becomes `ERR-SYS-001` with the original retained as `cause` for logging —
 * an unclassified fault must never reach a caller with its own message.
 */
export function toAppFailure(error: unknown): AppFailure {
  if (isAppFailure(error)) return error;
  return new AppFailure('ERR-SYS-001', {
    message: error instanceof Error ? error.message : 'Non-Error value thrown',
    cause: error,
  });
}
