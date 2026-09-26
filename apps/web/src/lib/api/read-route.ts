import type { z } from 'zod';
import {
  BROWSER_READ_HEADER,
  BROWSER_READ_HEADER_VALUE,
  type BrowserReadFailure,
} from './browser-read';

/**
 * The server half of a cancellable browser read (P1-32-PRE-OD-READ).
 *
 * Every route under `src/app/reads/*` is one call to `serveBrowserRead`, so the
 * refusals, the validation and the response headers are written once and a
 * family cannot forget one of them.
 *
 * ## What a route may and may not do
 *
 * It parses its input, calls ONE server read core with the request's signal,
 * and returns that core's envelope. It does not widen anything: the core reads
 * the session through `authorizedClient()`, and the API still receives the
 * bearer token and still decides authorization, tenant and branch scope and the
 * rate limit. An unknown parameter is refused rather than dropped, so what
 * reaches the core is exactly what the browser half sends.
 *
 * ## Search text travels in a body, never in an address
 *
 * The Owner's standing rule is that search terms never go in the URL. A URL is
 * what an access log, a proxy log and a browser's own tooling record, so a
 * family that carries text an operator typed — a name, a phone number, a plate,
 * a chassis fragment, a free-text term — is a `POST` whose parameters are a
 * JSON body (`input: 'body'`). Such a route refuses any query string at all, a
 * body that is not `application/json`, and a body with a key its schema does
 * not name. Only the two families that carry identifiers and a period and no
 * typed text — the overview figures and a customer's vehicles — stay a `GET`
 * with a query (`input: 'query'`).
 *
 * ## Why the header and the origin checks
 *
 * The session cookie is `SameSite=Lax`, which a cross-site top-level GET still
 * carries. A read answers data rather than changing state, but a read that
 * answers a foreign page is still a read nobody chose to publish. So a request
 * is refused, before any session is read, unless:
 *
 *   - it carries `x-rootlco-read: 1`. A cross-origin page cannot add a custom
 *     header without a CORS preflight, and nothing here answers one — the
 *     preflight fails and the request is never sent;
 *   - `Sec-Fetch-Site`, when the browser sends it, is `same-origin`. A link, an
 *     image or a form from another site says `cross-site` or `same-site`;
 *   - `Origin`, when present, names this host. Behind a proxy chain the host
 *     the edge saw is the FIRST value of `X-Forwarded-Host`, compared as a
 *     host and port under the origin's own scheme, so `web.test:443` and
 *     `https://web.test` agree and `web.test:8443` does not.
 *
 * ## Why every answer says `no-store`
 *
 * The body is one operator's view of one tenant's records. `private, no-store`
 * keeps it out of every shared and browser cache, and `Vary: Cookie` tells any
 * cache that ignores the first instruction that two sessions are two answers.
 * That includes a read that failed inside the core: it answers the family's own
 * `unavailable` envelope with the same headers rather than the framework's
 * default error page.
 */

/** Headers on every answer, refusals and failures included. */
export const READ_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'private, no-store',
  vary: 'Cookie',
  'x-content-type-options': 'nosniff',
});

/** The largest body a read accepts. Every schema's bounds together fit well inside it. */
export const READ_BODY_LIMIT_BYTES = 16 * 1024;

/** Why a request was refused before it was read, or null when it may proceed. */
export type ReadRefusal = 'header' | 'fetch-site' | 'origin';

/** A host, or a host and port, and nothing else: no scheme, path, userinfo or query. */
const AUTHORITY = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * The host a request was addressed to, as the edge saw it, lowercased.
 *
 * `X-Forwarded-Host` wins when present. Each proxy in a chain may append its own
 * value, so the header can read `web.test, internal:3100`; the FIRST value is
 * the one the browser addressed. An empty first value is not a host, and is
 * not quietly replaced by `Host` either — the request is then refused.
 */
export function requestHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host');
  const raw = forwarded !== null ? forwarded.split(',')[0] : request.headers.get('host');
  const host = raw?.trim().toLowerCase() ?? '';
  return host.length > 0 ? host : null;
}

/** Whether `host` names the same host and port as `origin`, under the origin's scheme. */
export function sameAuthority(origin: URL, host: string | null): boolean {
  if (host === null || !AUTHORITY.test(host)) return false;
  let addressed: URL;
  try {
    // Parsed under the origin's scheme so a default port reads the same both
    // ways: `https://web.test` and `web.test:443` are one authority.
    addressed = new URL(`${origin.protocol}//${host}`);
  } catch {
    return false;
  }
  return addressed.host === origin.host;
}

/** Whether this request may be served at all. See the module note. */
export function refusalOf(request: Request): ReadRefusal | null {
  if (request.headers.get(BROWSER_READ_HEADER) !== BROWSER_READ_HEADER_VALUE) return 'header';
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return 'fetch-site';
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return 'origin';
    }
    if (!sameAuthority(parsed, requestHost(request))) return 'origin';
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
 *
 * The object has no prototype, so every parameter — `__proto__` included —
 * lands as an own key. On a plain object `out['__proto__'] = 'x'` would be
 * swallowed by the prototype setter and the parameter would vanish instead of
 * being refused; as an own key it reaches `carriesPrototypeKey` below.
 */
export function queryObject(url: URL): Record<string, string> | null {
  const out = Object.create(null) as Record<string, string>;
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) return null;
    out[key] = values[0] as string;
  }
  return out;
}

/**
 * Whether the parameters carry an own `__proto__` key.
 *
 * A strict zod object refuses every key its shape does not name EXCEPT this
 * one, which it passes over without a word — so without this check the
 * parameter would be dropped rather than refused, against the rule that what
 * reaches the core is exactly what was sent. Both a query (see `queryObject`)
 * and a parsed JSON body hold it as an own key, so one check covers both.
 */
export function carriesPrototypeKey(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && Object.hasOwn(raw, '__proto__');
}

/** Whether a `Content-Type` names JSON, parameters such as `charset` aside. */
export function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  return (value.split(';')[0] ?? '').trim().toLowerCase() === 'application/json';
}

/**
 * The body as UTF-8 text, read chunk by chunk and never past the limit.
 *
 * `request.text()` would buffer whatever a client chose to send before the
 * size could be checked, and a chunked body declares no length to refuse it
 * by. So the stream is read here, the running byte count is checked after
 * every chunk, and the read is cancelled the moment the count passes
 * `READ_BODY_LIMIT_BYTES`: at most one chunk past the limit is ever held.
 * The bytes are decoded only once the whole body is known to fit, and a body
 * that is not valid UTF-8 is refused rather than repaired.
 */
async function readCappedBody(
  request: Request
): Promise<
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly status: 400 | 413 }
> {
  const body = request.body;
  if (body === null) return { ok: true, text: '' };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > READ_BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** What went wrong with an input, as the status the route answers. */
type InputOutcome =
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly status: 400 | 405 | 413 | 415 };

/**
 * A POST body as a plain object.
 *
 * Refused: a query string of any kind (the body is the only place parameters
 * travel), a content type other than JSON, a body over `READ_BODY_LIMIT_BYTES`
 * (by its declared length before a byte is read, and by its counted length
 * while it streams — see `readCappedBody`), a body that is not UTF-8 or does
 * not parse, and one that is not a plain object. JSON that
 * repeats a key keeps its last value, as `JSON.parse` does; the body is written
 * by `JSON.stringify` in the browser half and is recorded in no address, so the
 * disagreement the query rule guards against has no second reader here.
 */
async function bodyInput(request: Request): Promise<InputOutcome> {
  if (request.method !== 'POST') return { ok: false, status: 405 };
  if (new URL(request.url).search.length > 0) return { ok: false, status: 400 };
  if (!isJsonContentType(request.headers.get('content-type'))) return { ok: false, status: 415 };
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > READ_BODY_LIMIT_BYTES) {
    return { ok: false, status: 413 };
  }
  const body = await readCappedBody(request);
  if (!body.ok) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, status: 400 };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400 };
  }
  return { ok: true, raw: parsed };
}

/** A GET query as an object. */
function queryInput(request: Request): InputOutcome {
  if (request.method !== 'GET') return { ok: false, status: 405 };
  const raw = queryObject(new URL(request.url));
  return raw === null ? { ok: false, status: 400 } : { ok: true, raw };
}

export interface BrowserReadSpec<Params, Envelope extends { readonly status: string }> {
  /** Where the parameters travel: a JSON body (search text) or a query (identifiers only). */
  readonly input: 'body' | 'query';
  /** The strict schema the parameters must satisfy. */
  readonly schema: z.ZodType<Params>;
  /** The ONE server read core, handed this request's signal. */
  readonly run: (params: Params, signal: AbortSignal) => Promise<Envelope>;
  /** The family's own failure envelope, answered when the core throws. */
  readonly failure: (status: BrowserReadFailure, correlationId: string | null) => Envelope;
}

/**
 * Serves one browser read.
 *
 * - refused (header, fetch site, origin): 403 `{ status: 'denied' }`;
 * - an input the route does not accept: 400, 405, 413 or 415 `{ status: 'error' }`;
 * - the core threw: 503 with the family's own `unavailable` envelope;
 * - otherwise 200 with the core's own envelope, which carries the API's
 *   verdict — `expired` when there is no session.
 *
 * Every refusal is decided before the session is read. The request's signal
 * reaches the core, and through it the API call, so a browser that gives up on
 * the read stops the work behind it.
 */
export async function serveBrowserRead<Params, Envelope extends { readonly status: string }>(
  request: Request,
  spec: BrowserReadSpec<Params, Envelope>
): Promise<Response> {
  if (refusalOf(request) !== null) {
    return answer({ status: 'denied', correlationId: null }, 403, null);
  }
  const input = spec.input === 'body' ? await bodyInput(request) : queryInput(request);
  if (!input.ok) {
    return answer({ status: 'error', correlationId: null }, input.status, null);
  }
  if (carriesPrototypeKey(input.raw)) {
    return answer({ status: 'error', correlationId: null }, 400, null);
  }
  const parsed = spec.schema.safeParse(input.raw);
  if (!parsed.success) {
    return answer({ status: 'error', correlationId: null }, 400, null);
  }
  let envelope: Envelope;
  try {
    envelope = await spec.run(parsed.data, request.signal);
  } catch {
    // Nothing about the fault reaches the browser — not a message, not a
    // stack — only the state the screen already knows how to render.
    return answer(spec.failure('unavailable', null), 503, null);
  }
  const correlationId = (envelope as { readonly correlationId?: unknown }).correlationId;
  return answer(envelope, 200, typeof correlationId === 'string' ? correlationId : null);
}
