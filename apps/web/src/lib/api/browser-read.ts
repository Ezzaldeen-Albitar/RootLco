import { z } from 'zod';
import type { ServerPage, ServerPageStatus } from '@/components/data-table/use-server-table';
import { PAGE_SIZES } from '@/components/data-table/table-state';
import { CLIENT_READ_TIMEOUT_MS } from './read-budget';
import type { ReadState } from './read-operation';

/**
 * A read the browser can CANCEL (P1-32-PRE-OD-READ).
 *
 * ## Why this exists beside the Server Actions
 *
 * Every browser read used to be a Server Action, and the installed Next
 * (16.3.3) gives a Server Action call two properties a search box cannot live
 * with:
 *
 *   - **One at a time per page.** `dispatchAction` in
 *     `next/dist/client/components/app-router-instance.js` is a linked-list
 *     queue: a call made while another is pending waits for it to settle.
 *     Typing "Kha" then "Khal" queued the second read behind the first, and a
 *     slow board read held every mutation on the page behind it.
 *   - **Not abortable.** `fetchServerAction` in
 *     `.../router-reducer/reducers/server-action-reducer.js` posts with no
 *     `signal`, and there is no public way to pass one. Aborting on the client
 *     could only DISCARD the answer; the web tier and the API kept working.
 *
 * A Route Handler has neither property. Its request carries a signal that
 * Next aborts when the browser disconnects (`build/templates/app-route.js`
 * builds the request with `signalFromNodeResponse`), and requests to it run in
 * parallel. So the hottest reads — the two boards, the overview figures, the
 * customer and vehicle searches and the customer's vehicles — go through a
 * route under `/reads/*`, and this module is the browser half of that hop.
 *
 * ## Search text travels in a body
 *
 * The Owner's standing rule is that search terms never go in the URL, so a
 * family that carries text an operator typed is a `POST` whose parameters are a
 * JSON body, and its address is the bare route. Only a family that carries
 * identifiers and a period and nothing typed is a `GET` with a query. Each
 * family states which with `method`; there is no default to forget.
 *
 * ## What it does and does not change
 *
 * The session stays where it was: an `httpOnly` cookie the browser attaches to
 * a same-origin request and cannot read. The route reads it with the same
 * `authorizedClient()` the Server Actions use, and the API still receives the
 * bearer token and still decides authorization, tenant and branch scope and the
 * rate limit. Nothing here holds a token.
 *
 * ## Cancelled is not unavailable
 *
 * Two different things can stop a read here, and they are kept apart:
 *
 *   - **The caller aborted** (the operator typed again, switched branch, left
 *     the screen). That is not an answer, so the promise REJECTS with an
 *     `AbortError` — `isCancelledRead` names it. The fetch is torn down, the
 *     connection closes, and the route's signal aborts the API call in turn.
 *   - **The read failed** — the network dropped, the web tier answered 5xx, or
 *     the read outlived `CLIENT_READ_TIMEOUT_MS`. That IS an answer, and it
 *     resolves as `unavailable`, the same state a failed Server Action call
 *     became through `settleRead`, so the screens render exactly what they did.
 *
 * `fetch` is legal here and nowhere else in the feature trees
 * (`check-api-boundary.mjs`); this is the only `fetch(` this change adds.
 */

/** The header every browser read carries, and the route refuses a request without. */
export const BROWSER_READ_HEADER = 'x-rootlco-read';
export const BROWSER_READ_HEADER_VALUE = '1';

/** The route segment every cancellable read is served under. */
export const BROWSER_READ_PREFIX = '/reads/';

/** The failure words a read envelope may carry — the six `ServerPageStatus` values less `ok`. */
export type BrowserReadFailure = Exclude<ServerPageStatus, 'ok'>;

const FAILURES: ReadonlySet<string> = new Set<BrowserReadFailure>([
  'denied',
  'expired',
  'unavailable',
  'error',
  'not-found',
]);

/** What a read answers once decoded, or null when the body is not that. */
export type AcceptBody<T> = (body: unknown) => T | null;

/** How a family's parameters travel: `POST` with a JSON body, or `GET` with a query. */
export type BrowserReadMethod = 'GET' | 'POST';

export interface BrowserReadRequest<T> {
  /** The route, under `BROWSER_READ_PREFIX`. */
  readonly route: string;
  /** `POST` for a family that carries search text, `GET` for one that carries none. */
  readonly method: BrowserReadMethod;
  /**
   * The parameters: a JSON body for `POST`, the query for `GET`. Undefined,
   * null and empty values are left out either way.
   */
  readonly params: Readonly<Record<string, string | undefined | null>>;
  /** Aborting it cancels the fetch, and the promise rejects with an `AbortError`. */
  readonly signal?: AbortSignal | undefined;
  /** Decodes a 2xx body. Null means the body is not what the route sends. */
  readonly accept: AcceptBody<T>;
  /** The view state for a failure, in the family's own shape. */
  readonly failure: (status: BrowserReadFailure, correlationId: string | null) => T;
  /** Overrides the ceiling. `CLIENT_READ_TIMEOUT_MS` unless stated. */
  readonly timeoutMs?: number;
}

/** True for the rejection a cancelled read produces, and for nothing else. */
export function isCancelledRead(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly name?: unknown }).name === 'AbortError'
  );
}

function cancelled(): DOMException {
  return new DOMException('The read was cancelled before it answered.', 'AbortError');
}

/** The parameters that are actually present: undefined, null and empty values left out. */
export function presentParams(
  params: Readonly<Record<string, string | undefined | null>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** A route address with its query. The route is a literal under our own origin. */
export function browserReadUrl(
  route: string,
  params: Readonly<Record<string, string | undefined | null>>
): string {
  if (!route.startsWith(BROWSER_READ_PREFIX)) {
    throw new Error(`A browser read must address a route under ${BROWSER_READ_PREFIX}.`);
  }
  const rendered = new URLSearchParams(presentParams(params)).toString();
  return rendered.length > 0 ? `${route}?${rendered}` : route;
}

/**
 * The address and body one read sends.
 *
 * A `POST` addresses the bare route and carries every parameter in its JSON
 * body, so nothing an operator typed is ever part of an address. A `GET`
 * carries its parameters in the query and has no body.
 */
export function browserReadInit(
  route: string,
  method: BrowserReadMethod,
  params: Readonly<Record<string, string | undefined | null>>
): { readonly url: string; readonly body: string | null } {
  if (method === 'POST') {
    return { url: browserReadUrl(route, {}), body: JSON.stringify(presentParams(params)) };
  }
  return { url: browserReadUrl(route, params), body: null };
}

/** The failure a status code means when the body did not say. */
function failureForHttp(status: number): BrowserReadFailure {
  if (status === 401) return 'expired';
  if (status === 403) return 'denied';
  // A throttle, a timeout and every server fault are "try again shortly" — the
  // same `unavailable` a rejected Server Action call became.
  if (status === 408 || status === 429 || status >= 500) return 'unavailable';
  return 'error';
}

function statedFailure(body: unknown): BrowserReadFailure | null {
  if (typeof body !== 'object' || body === null) return null;
  const status = (body as { readonly status?: unknown }).status;
  return typeof status === 'string' && FAILURES.has(status) ? (status as BrowserReadFailure) : null;
}

function correlationOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { readonly correlationId?: unknown }).correlationId;
  return typeof value === 'string' ? value : null;
}

/**
 * One cancellable read.
 *
 * Resolves with the family's view state for every answer, including every
 * failure; rejects only when `signal` was aborted (`isCancelledRead`).
 */
export async function browserRead<T>(request: BrowserReadRequest<T>): Promise<T> {
  const { signal } = request;
  if (signal?.aborted) throw cancelled();

  const { url, body: sent } = browserReadInit(request.route, request.method, request.params);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  // Our own ceiling ABORTS the fetch as well as answering, so a read that has
  // been given up on stops occupying a connection and the route's API call.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs ?? CLIENT_READ_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers: {
          [BROWSER_READ_HEADER]: BROWSER_READ_HEADER_VALUE,
          accept: 'application/json',
          ...(sent === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(sent === null ? {} : { body: sent }),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) throw cancelled();
      return request.failure('unavailable', null);
    }
    // A cancelled read never answers, whatever the transport did after the
    // abort — so a response that raced it is dropped here, not rendered.
    if (signal?.aborted) throw cancelled();

    const headerCorrelation = response.headers.get('x-correlation-id');
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (signal?.aborted) throw cancelled();
    // The ceiling can also land while the body is still arriving.
    if (timedOut) return request.failure('unavailable', headerCorrelation);

    if (response.ok) {
      const accepted = request.accept(body);
      if (accepted !== null) return accepted;
      return request.failure('error', correlationOf(body) ?? headerCorrelation);
    }
    const stated = statedFailure(body);
    return request.failure(
      stated ?? failureForHttp(response.status),
      correlationOf(body) ?? headerCorrelation
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------------------ *
 * The two envelope shapes the phase-one families answer in
 * ------------------------------------------------------------------ */

/** A failed page, in the shape `useServerTable` and the search adapters already read. */
export function pageFailure<Row>(
  status: BrowserReadFailure,
  correlationId: string | null
): ServerPage<Row> {
  return { status, rows: [], nextCursor: null, hasMore: false, correlationId };
}

/** A failed single read. */
export function readFailure<T>(
  status: BrowserReadFailure,
  correlationId: string | null
): ReadState<T> {
  return { status, correlationId };
}

/** A `ServerPage` body, checked for the fields every renderer reads. */
export function acceptServerPage<Row>(body: unknown): ServerPage<Row> | null {
  if (typeof body !== 'object' || body === null) return null;
  const page = body as Record<string, unknown>;
  const status = page.status;
  if (status !== 'ok' && (typeof status !== 'string' || !FAILURES.has(status))) return null;
  if (!Array.isArray(page.rows)) return null;
  if (page.nextCursor !== null && typeof page.nextCursor !== 'string') return null;
  if (typeof page.hasMore !== 'boolean') return null;
  if (page.correlationId !== null && typeof page.correlationId !== 'string') return null;
  return body as ServerPage<Row>;
}

/** A `ReadState` body: `ok` with data, or one of the failure words. */
export function acceptReadState<T>(body: unknown): ReadState<T> | null {
  if (typeof body !== 'object' || body === null) return null;
  const state = body as Record<string, unknown>;
  if (state.correlationId !== null && typeof state.correlationId !== 'string') return null;
  if (state.status === 'ok') return 'data' in state ? (body as ReadState<T>) : null;
  return typeof state.status === 'string' && FAILURES.has(state.status)
    ? (body as ReadState<T>)
    : null;
}

/* ------------------------------------------------------------------ *
 * Query parameter shapes shared by every route and its browser half
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The value shapes a read route accepts.
 *
 * Bounds on LENGTH and FORM only. What a value may mean — whether a status is
 * known, whether this caller may read that branch — is the API's to decide, and
 * it still does: the route forwards exactly these values and nothing else.
 */
export const readParam = Object.freeze({
  /** A record identifier. */
  id: z.string().regex(UUID),
  /** Free text or a date bound, as the screens send it. */
  text: z.string().min(1).max(256),
  /** An opaque cursor the API issued. */
  cursor: z.string().min(1).max(2048),
  /** One of the page sizes a table offers. */
  pageSize: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .refine((size) => PAGE_SIZES.includes(size)),
  /** A board flag, as the two literals the API reads. */
  flag: z.enum(['true', 'false']),
});

/** The flag literal for a boolean, or nothing at all when it was not asked. */
export function flagParam(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'true' : 'false';
}

/** The boolean a flag literal names. */
export function flagValue(value: 'true' | 'false' | undefined): boolean | undefined {
  return value === undefined ? undefined : value === 'true';
}
