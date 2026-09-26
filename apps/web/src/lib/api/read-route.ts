import type { z } from 'zod';
import { BROWSER_READ_HEADER, BROWSER_READ_HEADER_VALUE } from './browser-read';

/**
 * The server half of a cancellable browser read (P1-32-PRE-OD-READ).
 *
 * Every route under `src/app/reads/*` is one call to `serveBrowserRead`, so the
 * refusals, the validation and the response headers are written once and a
 * family cannot forget one of them.
 *
 * ## What a route may and may not do
 *
 * It parses its query, calls ONE server read core with the request's signal,
 * and returns that core's envelope. It does not widen anything: the core is the
 * same body the Server Action runs, it reads the session through the same
 * `authorizedClient()`, and the API still receives the bearer token and still
 * decides authorization, tenant and branch scope and the rate limit. An unknown
 * parameter is refused rather than dropped, so what reaches the core is exactly
 * what the browser half sends.
 *
 * ## Why the header and the origin checks
 *
 * The session cookie is `SameSite=Lax`, which a cross-site top-level GET still
 * carries. A read answers data rather than changing state, but a read that
 * answers a foreign page is still a read nobody chose to publish. So a request
 * is refused unless:
 *
 *   - it carries `x-rootlco-read: 1`. A cross-origin page cannot add a custom
 *     header without a CORS preflight, and nothing here answers one — the
 *     preflight fails and the request is never sent;
 *   - `Sec-Fetch-Site`, when the browser sends it, is `same-origin`. A link, an
 *     image or a form from another site says `cross-site` or `same-site`;
 *   - `Origin`, when present, names this host.
 *
 * ## Why every answer says `no-store`
 *
 * The body is one operator's view of one tenant's records. `private, no-store`
 * keeps it out of every shared and browser cache, and `Vary: Cookie` tells any
 * cache that ignores the first instruction that two sessions are two answers.
 */

/** Headers on every answer, refusals included. */
export const READ_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'private, no-store',
  vary: 'Cookie',
  'x-content-type-options': 'nosniff',
});

/** Why a request was refused before it was read, or null when it may proceed. */
export type ReadRefusal = 'header' | 'fetch-site' | 'origin';

/** The host a request was addressed to, as the edge saw it. */
function requestHost(request: Request): string | null {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host');
}

/** Whether this request may be served at all. See the module note. */
export function refusalOf(request: Request): ReadRefusal | null {
  if (request.headers.get(BROWSER_READ_HEADER) !== BROWSER_READ_HEADER_VALUE) return 'header';
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return 'fetch-site';
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return 'origin';
    }
    if (originHost !== requestHost(request)) return 'origin';
  }
  return null;
}

function answer(body: unknown, status: number, correlationId: string | null): Response {
  const headers = new Headers(READ_RESPONSE_HEADERS);
  if (correlationId !== null) headers.set('x-correlation-id', correlationId);
  return Response.json(body, { status, headers });
}

/**
 * The query as an object, or null when a parameter is repeated.
 *
 * A repeated key is refused rather than resolved: taking the first or the last
 * would mean the route and a reader of the URL could disagree about what was
 * asked.
 */
export function queryObject(url: URL): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) return null;
    out[key] = values[0] as string;
  }
  return out;
}

/**
 * Serves one browser read.
 *
 * - refused (header, fetch site, origin): 403 `{ status: 'denied' }`;
 * - an invalid query: 400 `{ status: 'error' }`;
 * - otherwise 200 with the core's own envelope, which carries the API's
 *   verdict — `expired` when there is no session, exactly as the action answers.
 *
 * The request's signal reaches the core, and through it the API call, so a
 * browser that gives up on the read stops the work behind it.
 */
export async function serveBrowserRead<Params, Envelope extends { readonly status: string }>(
  request: Request,
  schema: z.ZodType<Params>,
  run: (params: Params, signal: AbortSignal) => Promise<Envelope>
): Promise<Response> {
  if (refusalOf(request) !== null) {
    return answer({ status: 'denied', correlationId: null }, 403, null);
  }
  const raw = queryObject(new URL(request.url));
  const parsed = raw === null ? null : schema.safeParse(raw);
  if (parsed === null || !parsed.success) {
    return answer({ status: 'error', correlationId: null }, 400, null);
  }
  const envelope = await run(parsed.data, request.signal);
  const correlationId = (envelope as { readonly correlationId?: unknown }).correlationId;
  return answer(envelope, 200, typeof correlationId === 'string' ? correlationId : null);
}
