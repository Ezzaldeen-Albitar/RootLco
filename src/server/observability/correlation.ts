/**
 * Correlation-ID lifecycle (P1-13-BE-008).
 *
 * One identifier ties a request to its logs, audit record, outbox envelope,
 * worker processing, monitoring event, and response header.
 *
 * **Inbound values are untrusted.** A client may propose a correlation ID so a
 * caller-side trace can be joined, but the proposal is accepted only if it is a
 * syntactically valid UUID. Anything else — a log-forging payload, a newline, an
 * oversized string, an SQL fragment — is discarded and replaced with a freshly
 * generated ID. It is never echoed back, because echoing unvalidated input is
 * exactly how log forging and header injection start.
 *
 * The database columns are `uuid`, so UUID is the only representable form; that
 * constraint is the reason the rule can be this strict.
 */
import { randomUUID } from 'node:crypto';

/** Header carrying the correlation ID in both directions. */
export const CORRELATION_HEADER = 'x-correlation-id';

/** Header carrying the causation ID (the event/command that caused this one). */
export const CAUSATION_HEADER = 'x-causation-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True only for a canonical RFC 9562 UUID (variant 1, versions 1–8). */
export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** A fresh correlation ID. */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Normalises an inbound header value to a usable correlation ID.
 *
 * Returns the proposal only when it is a valid UUID; otherwise returns a new ID.
 * The second element reports whether the inbound value was accepted, so the
 * decision is observable in logs and testable, rather than silent.
 */
export function normalizeInboundCorrelationId(inbound: string | null | undefined): {
  correlationId: string;
  inboundAccepted: boolean;
} {
  if (isValidCorrelationId(inbound)) {
    return { correlationId: inbound.toLowerCase(), inboundAccepted: true };
  }
  return { correlationId: newCorrelationId(), inboundAccepted: false };
}

/**
 * Normalises an inbound causation ID. Unlike the correlation ID there is no
 * fallback: an absent or invalid causation ID is simply absent, because
 * inventing a causal ancestor would be a lie in the event envelope.
 */
export function normalizeInboundCausationId(inbound: string | null | undefined): string | null {
  return isValidCorrelationId(inbound) ? inbound.toLowerCase() : null;
}
