/**
 * How long a read may take, stated once for both sides of the Server Action hop.
 *
 * ## Why this is its own module
 *
 * The server's API client (`client.ts`) and the browser's read hooks
 * (`use-search-request.ts`) must agree on these figures: the browser's ceiling
 * is DERIVED from the server's timeout and retry clamp, so a change to either
 * moves both. They used to live in `client.ts`, which meant a `'use client'`
 * hook imported the whole server API client — its English message catalogue
 * and the idempotent-operation table among it — to read three numbers.
 *
 * This file imports nothing, so a browser module that needs the budget pays for
 * the budget and nothing else. `client.ts` re-exports the three server figures,
 * so no existing import of them changed.
 */

/** One attempt's timeout on the server's API client. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Retries a read makes when the caller does not say. One, not a loop — see `get`. */
export const DEFAULT_READ_RETRIES = 1;

/**
 * The most retries any read may ask for. `get` clamps to it, so no read on the
 * server ever makes more than `MAX_READ_RETRIES + 1` attempts of
 * `DEFAULT_TIMEOUT_MS` each — the bound a client-side ceiling must sit above.
 */
export const MAX_READ_RETRIES = 2;

/** The longest ONE server read can legitimately take: every attempt, each timing out. */
export const SERVER_READ_WORST_CASE_MS = DEFAULT_TIMEOUT_MS * (MAX_READ_RETRIES + 1);

/**
 * The allowance for a call waiting its turn before its own attempts begin.
 *
 * Server Action calls from one page are sent one at a time, so a read can sit
 * behind an earlier action. One further per-attempt timeout covers it.
 */
export const CLIENT_READ_QUEUE_MARGIN_MS = DEFAULT_TIMEOUT_MS;

/**
 * The browser's ceiling for a loader that makes `serverReads` reads in SEQUENCE.
 *
 * A loader that first re-reads the caller's scope and then reads the page
 * spends up to two worst cases on the server before it can answer, so a ceiling
 * sized for one read would abandon it while the second read was still
 * legitimately running — and show an outage over an answer about to arrive.
 * The queueing margin is added once: it is the wait BEFORE the loader starts,
 * and the reads inside it run back to back on the server.
 *
 * Reads made in PARALLEL (`Promise.all`) count once. Anything that is not a
 * whole number of at least one is treated as one, so a mistyped count can only
 * leave the single-read ceiling in place, never shrink it.
 */
export function clientReadTimeoutMs(serverReads = 1): number {
  const reads = Number.isInteger(serverReads) && serverReads > 1 ? serverReads : 1;
  return reads * SERVER_READ_WORST_CASE_MS + CLIENT_READ_QUEUE_MARGIN_MS;
}

/** The ceiling for a loader that makes one server read — the default everywhere. */
export const CLIENT_READ_TIMEOUT_MS = clientReadTimeoutMs(1);
