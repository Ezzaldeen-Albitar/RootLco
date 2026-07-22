/**
 * Error catalog — the single registry of stable `ERR-` codes (P1-13-BE-007).
 *
 * Two rules make this useful rather than decorative:
 *
 *  1. **A code exists here or it does not exist.** `problemFor()` only accepts a
 *     registered code, so an ad-hoc string cannot reach a response. Adding a code
 *     is a reviewable change to this file, never a literal buried in a handler.
 *  2. **`safeDetail` is the contract, not a suggestion.** Anything a caller sees
 *     is assembled from the registry entry plus explicitly-allowed fields. No
 *     stack trace, SQL fragment, internal identifier, or upstream driver message
 *     is ever forwarded (see `problem.ts`).
 *
 * `retryable` is advisory for clients and for the worker's failure classification;
 * it never changes authorization or transaction behaviour.
 */

/** Every registered error code. The union is the compile-time gate. */
export const ERROR_CODES = [
  'ERR-REQ-001',
  'ERR-REQ-002',
  'ERR-VAL-001',
  'ERR-PAG-001',
  'ERR-IAM-001',
  'ERR-IAM-002',
  'ERR-TEN-001',
  'ERR-CTX-001',
  'ERR-RES-001',
  'ERR-RES-002',
  'ERR-DEP-001',
  'ERR-INT-001',
  'ERR-INT-002',
  'ERR-CON-001',
  'ERR-CON-002',
  'ERR-RTE-001',
  'ERR-STB-001',
  'ERR-SYS-001',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Audit/alerting class. `security` codes are security-event candidates. */
export type ErrorClass = 'client' | 'security' | 'conflict' | 'throttle' | 'server';

export interface ErrorDefinition {
  /** Stable catalog code. Never reused, never renumbered. */
  readonly code: ErrorCode;
  /** Short, caller-safe title. Becomes the problem document `title`. */
  readonly title: string;
  /** HTTP status returned for this code. */
  readonly status: number;
  /** Owning area, for catalog navigation and ownership review. */
  readonly owner:
    | 'request'
    | 'validation'
    | 'authorization'
    | 'entitlement'
    | 'context'
    | 'resource'
    | 'idempotency'
    | 'concurrency'
    | 'throttling'
    | 'stub'
    | 'platform';
  /** Advisory: may the same request succeed later without modification? */
  readonly retryable: boolean;
  /** Classification used by logging, audit, and security-event emission. */
  readonly class: ErrorClass;
  /** Engineering description. Documentation only — never returned to a caller. */
  readonly description: string;
}

const DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>> = Object.freeze({
  'ERR-REQ-001': {
    code: 'ERR-REQ-001',
    title: 'Malformed request',
    status: 400,
    owner: 'request',
    retryable: false,
    class: 'client',
    description:
      'The request could not be read: unparseable body, unsupported content type, or a header that violates its contract.',
  },
  'ERR-REQ-002': {
    code: 'ERR-REQ-002',
    title: 'Unsupported API version',
    status: 404,
    owner: 'request',
    retryable: false,
    class: 'client',
    description: 'The requested API version segment is not served by this deployment.',
  },
  'ERR-VAL-001': {
    code: 'ERR-VAL-001',
    title: 'Request validation failed',
    status: 422,
    owner: 'validation',
    retryable: false,
    class: 'client',
    description:
      'Boundary validation rejected the request. Field-level violations are returned with stable Zod issue codes and paths; submitted values are never echoed.',
  },
  'ERR-PAG-001': {
    code: 'ERR-PAG-001',
    title: 'Invalid pagination cursor',
    status: 400,
    owner: 'validation',
    retryable: false,
    class: 'client',
    description:
      'The opaque cursor is malformed, truncated, or was issued for a different ordering contract.',
  },
  'ERR-IAM-001': {
    code: 'ERR-IAM-001',
    title: 'Not permitted',
    status: 403,
    owner: 'authorization',
    retryable: false,
    class: 'security',
    description:
      'Server-side authorization denied the operation (BR-IAM-001, deny precedence). Uniform denial: the response never reveals whether the target resource exists.',
  },
  'ERR-IAM-002': {
    code: 'ERR-IAM-002',
    title: 'Authentication required',
    status: 401,
    owner: 'authorization',
    retryable: false,
    class: 'security',
    description: 'No authenticated principal could be resolved for the request.',
  },
  'ERR-TEN-001': {
    code: 'ERR-TEN-001',
    title: 'Feature not enabled',
    status: 403,
    owner: 'entitlement',
    retryable: false,
    class: 'security',
    description:
      'The resolved tenant is not entitled to the feature required by this operation, evaluated against the entitlement effective at command time (BR-TEN-001).',
  },
  'ERR-CTX-001': {
    code: 'ERR-CTX-001',
    title: 'Request context unavailable',
    status: 500,
    owner: 'context',
    retryable: false,
    class: 'server',
    description:
      'A controlled data-access call was attempted without a resolved request context. This is an internal invariant violation: it fails closed and is never surfaced with detail.',
  },
  'ERR-RES-001': {
    code: 'ERR-RES-001',
    title: 'Resource not found',
    status: 404,
    owner: 'resource',
    retryable: false,
    class: 'client',
    description:
      'The addressed resource does not exist within the resolved scope. Indistinguishable from "exists but out of scope" by design.',
  },
  'ERR-RES-002': {
    code: 'ERR-RES-002',
    title: 'Resource already exists',
    status: 409,
    owner: 'resource',
    retryable: false,
    class: 'conflict',
    description:
      'The command would create a resource that already exists within the resolved scope. Used where the duplicate is safe to acknowledge — an invitation for an address already invited, a role code already taken. Never used on an authentication path, where acknowledging existence would be an enumeration oracle.',
  },
  'ERR-DEP-001': {
    code: 'ERR-DEP-001',
    title: 'Upstream dependency unavailable',
    status: 503,
    owner: 'platform',
    retryable: true,
    class: 'server',
    description:
      'A required external dependency — currently only the authentication provider — was unreachable, timed out, or returned a fault. The request performed no work and may be retried. The dependency is never named to the caller.',
  },
  'ERR-INT-001': {
    code: 'ERR-INT-001',
    title: 'Idempotency key conflict',
    status: 409,
    owner: 'idempotency',
    retryable: false,
    class: 'conflict',
    description:
      'The idempotency key was already used for a request with a different fingerprint. Re-using a key with different content is always rejected (FR-INT-002).',
  },
  'ERR-INT-002': {
    code: 'ERR-INT-002',
    title: 'Idempotency key required',
    status: 400,
    owner: 'idempotency',
    retryable: false,
    class: 'client',
    description:
      'The operation is declared idempotency-critical and the Idempotency-Key header was absent or violated its format contract.',
  },
  'ERR-CON-001': {
    code: 'ERR-CON-001',
    title: 'Record version conflict',
    status: 409,
    owner: 'concurrency',
    retryable: true,
    class: 'conflict',
    description:
      'Optimistic concurrency rejected the write: the supplied record version is not the current one. Re-read and retry.',
  },
  'ERR-CON-002': {
    code: 'ERR-CON-002',
    title: 'Record version required',
    status: 428,
    owner: 'concurrency',
    retryable: false,
    class: 'client',
    description:
      'The operation is declared version-guarded and the If-Match header was absent or malformed.',
  },
  'ERR-RTE-001': {
    code: 'ERR-RTE-001',
    title: 'Too many requests',
    status: 429,
    owner: 'throttling',
    retryable: true,
    class: 'throttle',
    description:
      'A configured rate limit was exceeded. The response carries Retry-After; abuse-relevant breaches are security-event candidates.',
  },
  'ERR-STB-001': {
    code: 'ERR-STB-001',
    title: 'Not implemented',
    status: 501,
    owner: 'stub',
    retryable: false,
    class: 'client',
    description:
      'A contract-only foundation service (file, notification) was invoked. The interface is frozen in P1-13; behaviour lands in the phase that owns it.',
  },
  'ERR-SYS-001': {
    code: 'ERR-SYS-001',
    title: 'Unexpected error',
    status: 500,
    owner: 'platform',
    retryable: true,
    class: 'server',
    description:
      'Fallback for an unclassified fault. The caller receives the correlation ID and nothing else; the cause is logged and sent to error monitoring.',
  },
});

/** True when `code` is a registered catalog code. */
export function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, code);
}

/** Registered definition for `code`. Throws for an unregistered code by design. */
export function errorDefinition(code: ErrorCode): ErrorDefinition {
  const definition = DEFINITIONS[code];
  /* c8 ignore next 4 -- unreachable while `code` is the ErrorCode union; kept as a
     runtime guard for JavaScript callers and for catalog edits that miss an entry. */
  if (!definition) {
    throw new Error(`Unregistered error code: ${code}`);
  }
  return definition;
}

/** Whole catalog, for documentation generation and catalog-coverage tests. */
export function allErrorDefinitions(): readonly ErrorDefinition[] {
  return ERROR_CODES.map((code) => errorDefinition(code));
}
