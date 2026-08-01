/**
 * RFC 9457 problem documents (P1-13-BE-007).
 *
 * Every failure — validation, authorization, throttling, unhandled fault —
 * leaves the API as the same shape, so a client writes one error path instead of
 * eleven. The document is assembled ONLY from the catalog entry plus the
 * failure's `safeDetails`; no other field of the thrown error is readable from
 * here, which is what makes "no stack traces, no internal identifiers" a
 * structural property rather than a review promise.
 *
 * `type` is a stable, dereferenceable-in-documentation URN rather than a live
 * URL: no documentation host is provisioned (ADR-012), and publishing a URL that
 * 404s is worse than publishing a stable identifier.
 */
import { type AppFailure } from './app-failure';
import { type ErrorCode, errorDefinition } from './catalog';
import { CORRELATION_HEADER } from '../observability/correlation';

/** Media type mandated by RFC 9457. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** URN namespace for problem types. Stable across deployments. */
export const PROBLEM_TYPE_PREFIX = 'urn:rootlco:error:';

export interface ProblemDocument {
  /** Stable problem-type identifier: `urn:rootlco:error:ERR-XXX-NNN`. */
  readonly type: string;
  /** Short, caller-safe summary from the catalog. */
  readonly title: string;
  /** HTTP status, duplicated in the body per RFC 9457. */
  readonly status: number;
  /** Catalog code. The field clients should branch on. */
  readonly code: ErrorCode;
  /** Correlation ID for support. Present on every response, success or failure. */
  readonly correlationId: string;
  /** Field-level violations. Validation failures only. */
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
  /** Seconds until retry is sensible. Throttling only. */
  readonly retryAfterSeconds?: number;
  /** Contract-only service name. Not-implemented stubs only. */
  readonly contract?: string;
  /** Permission codes the operation requires. Authorization failures only. */
  readonly requiredPermissions?: readonly string[];
}

/** Builds the problem document for a failure. Reads no unsafe field. */
export function problemFor(failure: AppFailure, correlationId: string): ProblemDocument {
  const definition = errorDefinition(failure.code);
  const details = failure.safeDetails;

  return {
    type: `${PROBLEM_TYPE_PREFIX}${definition.code}`,
    title: definition.title,
    status: definition.status,
    code: definition.code,
    correlationId,
    // Presence is decided by `!== undefined`, never by truthiness. A truthiness
    // test would silently drop a legitimately empty value (`contract: ''`) while
    // keeping an empty array, so two fields with the same intent would behave
    // differently. "Absent means the caller did not set it" is the whole rule.
    ...(details.violations !== undefined ? { violations: details.violations } : {}),
    ...(details.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: details.retryAfterSeconds }
      : {}),
    ...(details.contract !== undefined ? { contract: details.contract } : {}),
    ...(details.requiredPermissions !== undefined
      ? { requiredPermissions: details.requiredPermissions }
      : {}),
  };
}

/** Response headers that accompany a problem document. */
export function problemHeaders(failure: AppFailure, correlationId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': PROBLEM_CONTENT_TYPE,
    [CORRELATION_HEADER]: correlationId,
    // A failure is never a cacheable representation of a resource.
    'Cache-Control': 'no-store',
  };
  const retryAfter = failure.safeDetails.retryAfterSeconds;
  if (retryAfter !== undefined) {
    headers['Retry-After'] = String(Math.max(0, Math.ceil(retryAfter)));
  }
  return headers;
}
