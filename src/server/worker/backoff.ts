/**
 * Bounded exponential backoff with jitter (P1-13-BE-016, scalability foundation).
 *
 * Two failure modes this exists to prevent:
 *
 *  - **Retry storm.** A downstream outage makes every consumer fail at once; a
 *    fixed retry interval makes them all retry at once, forever, at full rate.
 *    Exponential growth with a ceiling turns that into a decaying trickle.
 *  - **Thundering herd.** Pure exponential backoff keeps failures *synchronised*
 *    — every event that failed together retries together. Full jitter spreads
 *    the retries across the whole window, which is why the jitter is applied to
 *    the entire delay rather than as a small ± wobble.
 *
 * `attempt` is 1-based and comes from `event_outbox.attempt_count`, which the
 * database increments on claim — so the schedule is driven by durable state, not
 * by in-process memory that a restart would lose.
 */

export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
  /** Injectable for deterministic tests. Must return [0, 1). */
  readonly random?: () => number;
}

/**
 * Full-jitter delay for `attempt`: uniform in `[0, min(maxMs, base * 2^(n-1))]`.
 *
 * Full jitter (rather than equal jitter) is chosen because the queue is durable:
 * a retry that lands early is harmless, and maximising spread matters more than
 * guaranteeing a minimum wait.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  const random = options.random ?? Math.random;
  // Cap the exponent before computing the power so a large attempt count cannot
  // produce Infinity on the way to being clamped.
  const exponent = Math.min(safeAttempt - 1, 30);
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** exponent);
  return Math.floor(random() * ceiling);
}

/** Backoff as a PostgreSQL interval string, for `shared.fail_outbox_event`. */
export function backoffInterval(attempt: number, options: BackoffOptions): string {
  const ms = backoffDelayMs(attempt, options);
  // Milliseconds are representable in an interval and avoid rounding a sub-second
  // backoff down to zero.
  return `${ms} milliseconds`;
}
