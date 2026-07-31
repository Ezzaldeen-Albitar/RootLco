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
  'ERR-INT-003',
  'ERR-CON-001',
  'ERR-CON-002',
  'ERR-RTE-001',
  'ERR-STB-001',
  'ERR-DOC-001',
  'ERR-NTF-001',
  'ERR-EXP-001',
  'ERR-RPT-001',
  'ERR-TRN-001',
  'ERR-WO-001',
  'ERR-WO-002',
  'ERR-TECH-001',
  'ERR-DIA-001',
  'ERR-QMS-001',
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
    | 'attachment'
    | 'notification'
    | 'export'
    | 'reporting'
    | 'transition'
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
      'A required external dependency — the authentication provider (P1-14), the object-storage provider, or the message-delivery provider (P1-15) — was unreachable, timed out, or returned a fault. The request performed no work and may be retried. The dependency is never named to the caller.',
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
  'ERR-INT-003': {
    code: 'ERR-INT-003',
    title: 'Idempotent request carries secret material',
    status: 400,
    owner: 'idempotency',
    retryable: false,
    class: 'client',
    description:
      'The request is for an idempotency-critical operation and its body or route parameters carry a field whose name marks it as secret material — a password, PIN, OTP, recovery code, private key or bearer credential. The idempotency fingerprint is a persisted SHA-256, and a fast unkeyed hash of a low-entropy secret is an offline guessing target (CWE-916), so the request is refused before anything is hashed. Classified as a CLIENT error deliberately: the fingerprint is computed over the raw pre-validation body, so any caller can put such a field there, and answering 500 would let any authenticated caller manufacture a server error on any idempotent endpoint. A field the ROUTE genuinely declares is prevented earlier and differently — the build fails, via the registration gate in tests/foundation/idempotency-secret-material.test.ts. The offending field NAME appears in the message; its value is never read, logged or returned.',
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
  'ERR-DOC-001': {
    code: 'ERR-DOC-001',
    title: 'Document version not available',
    status: 409,
    owner: 'attachment',
    retryable: false,
    class: 'conflict',
    description:
      'The addressed document version exists and is visible to the caller, but its state does not permit the requested action — most often a download of a version that has not been accepted. Distinct from ERR-RES-001 on purpose: the caller already knows the version exists (they can see it), so reporting "not found" would be misleading rather than protective. No P1-15 path can move a version to accepted, because acceptance requires a clean scan record and no scanner exists (DBCR-P1-15-001 §withholdings).',
  },
  'ERR-NTF-001': {
    code: 'ERR-NTF-001',
    title: 'Recipient consent not granted',
    status: 409,
    owner: 'notification',
    retryable: false,
    class: 'conflict',
    description:
      'The consent evaluation supplied with the queue request reported that the recipient has not granted consent for this channel, so nothing was enqueued. Neither an authorization failure (the caller may send) nor a validation failure (the request was well-formed): the request conflicts with the recipient’s recorded consent state, which only the recipient can change.',
  },
  'ERR-RPT-001': {
    code: 'ERR-RPT-001',
    title: 'Report not found',
    status: 404,
    owner: 'reporting',
    retryable: false,
    class: 'client',
    description:
      'No PUBLISHED report definition with this code exists in the caller\u2019s tenant. Deliberately indistinguishable between four cases \u2014 a draft, an archived report, another tenant\u2019s report, and a code that never existed \u2014 because a catalogue that answered them differently would be a way to enumerate which report codes a tenant has configured.',
  },
  'ERR-EXP-001': {
    code: 'ERR-EXP-001',
    title: 'Export exceeds the permitted size',
    status: 422,
    owner: 'export',
    retryable: false,
    class: 'client',
    description:
      'The requested export would return more rows than EXPORT_MAX_ROWS permits. A distinct code so a client can narrow its filters rather than retrying the same request; it is not a throttle and waiting does not help.',
  },
  'ERR-TRN-001': {
    code: 'ERR-TRN-001',
    title: 'Transition not permitted from the current state',
    status: 409,
    owner: 'transition',
    retryable: false,
    class: 'conflict',
    description:
      'The requested target state is registered for this aggregate, but the aggregate is not in a state the transition may start from — including the case where it is already in the target state. Distinct from ERR-CON-001, which means the caller held a stale record version: re-reading and retrying fixes a version conflict and cannot fix this one.',
  },
  'ERR-WO-001': {
    code: 'ERR-WO-001',
    title: 'Work order cannot be closed yet',
    status: 409,
    owner: 'transition',
    retryable: false,
    class: 'conflict',
    description:
      'Closure was refused by wo.guard_work_order_closure (blockers B1..B6): a non-terminal job, a running labor session, an unresolved required additional-work request, a missing completed diagnostic, failed or missing mandatory quality control, or safety-critical rework without independent sign-off. Deliberately NOT ERR-TRN-001: the ready_to_close→closed edge exists in the graph and the aggregate is in a legal starting state, so this is not a graph refusal. The caller must clear a condition, not re-read a version or pick a different target.',
  },
  'ERR-WO-002': {
    code: 'ERR-WO-002',
    title: 'Additional work awaits a customer decision',
    status: 409,
    owner: 'transition',
    retryable: false,
    class: 'conflict',
    description:
      'A job may not enter a state whose wo.job_states.labor_allowed is true while a REQUIRED additional-work request originating from it is still pending — work the customer has not yet authorised must not be started or resumed. Distinct from ERR-WO-001, which is the B1..B6 closure gate on the whole work order: this refuses one job movement, and only for requests naming that job as their origin. Deliberately NOT ERR-TRN-001, because the edge exists in the graph and the job is in a legal starting state; what blocks it is a sibling row. Pausing is never refused, so the job can wait in a state where labour is not allowed while the customer is asked. Approved-but-unfulfilled does NOT refuse execution: that is authorised work waiting to be done, and gating it would make it undoable.',
  },
  'ERR-TECH-001': {
    code: 'ERR-TECH-001',
    title: 'Technician is not eligible for this assignment',
    status: 422,
    owner: 'validation',
    retryable: false,
    class: 'client',
    description:
      'The named technician does not satisfy the job’s eligibility requirements: a missing or insufficient skill level, a missing or expired certification, no covering availability interval, an inactive profile, or an out-of-scope company/branch. A client error rather than a conflict because the request named the wrong technician; the same request will keep failing until a different technician is chosen or the underlying eligibility record changes.',
  },
  'ERR-DIA-001': {
    code: 'ERR-DIA-001',
    title: 'Diagnostic report has unresolved mandatory items',
    status: 409,
    owner: 'transition',
    retryable: false,
    class: 'conflict',
    description:
      'Completion was refused because at least one mandatory item of the pinned template version has neither a recorded result nor a documented not-applicable reason. A conflict rather than a validation failure: the completion request itself is well-formed, and what blocks it is the accumulated state of the report.',
  },
  'ERR-QMS-001': {
    code: 'ERR-QMS-001',
    title: 'Quality or rework precondition not satisfied',
    status: 409,
    owner: 'transition',
    retryable: false,
    class: 'conflict',
    description:
      'Covers the QMS refusals that are not closure blockers: an attempt to reopen a closed work order (BR-WO-002 — recorded as a rejected attempt in qms.reopen_attempts and never mutating the order), and a rework resolution lacking the independent sign-off BR-QMS-001 requires for safety-critical work. Distinct from ERR-WO-001, which is specifically the B1..B6 closure gate.',
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
