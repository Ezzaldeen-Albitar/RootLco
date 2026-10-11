import { NextResponse, type NextRequest } from 'next/server';
import { AppFailure } from '@/server/errors/app-failure';
import { problemFor, problemHeaders } from '@/server/errors/problem';
import {
  CORRELATION_HEADER,
  normalizeInboundCorrelationId,
} from '@/server/observability/correlation';
import { log } from '@/server/observability/logger';

/**
 * Refuses any query string on the two authenticated self-reads before the
 * framework can lose part of it (P1-32-PRE-OD-INVF, FRX1-c).
 *
 * `GET /api/v1/auth/session` and `GET /api/v1/auth/working-context` name no
 * target, so each route refuses every query parameter with `ERR-VAL-001`. A lone
 * `?__proto__=x` still reached them as no parameter at all: before a route
 * handler runs, Next rebuilds `req.url` from a parsed query object
 * (`normalizeCdnUrl` in `next/dist/server/server-utils.js`, called from
 * `next/dist/server/route-modules/route-module.js` in `prepare`), and a plain
 * object cannot hold a `__proto__` key, so the key is gone from the URL the
 * handler reads and the route's own guard has nothing to refuse.
 *
 * This proxy runs earlier, and `skipProxyUrlNormalize` in `next.config.ts` hands
 * it the URL as it arrived. So the raw search string is the authority here:
 * anything after `?` — `__proto__`, `constructor`, an encoded name, `=x`, a bare
 * `x` — is refused with the same status and problem document the routes
 * produce. A bare `?` carries no parameter and is passed through, as the routes
 * pass it.
 *
 * ## Which spellings are judged
 *
 * The proxy runs for everything under `/api/v1/auth/` and judges a request when
 * its CANONICAL path (`canonicalPath`) is one of the two self-reads: dot
 * segments resolved (by `URL`, which also treats `%2e` as a dot), an escaped
 * unreserved character (`%73` for `s`) decoded, repeated slashes collapsed and
 * one trailing slash dropped. Against a production build of Next 16.3.8 the
 * only other spellings that reach a self-read handler are the dot-segment ones
 * (`/api/v1/./auth/session`, `/api/v1/x/../auth/session`, `/auth/%2e/session`);
 * escaped letters, upper case, `;` and `%2F` answer 404, and a trailing or
 * doubled slash is redirected (308) before the proxy runs. Decoding the
 * unreserved escapes is defence in depth for a framework that starts routing
 * them. Case is not folded, because Next matches case-sensitively. Every other
 * request — another auth route, another method, no query — passes through
 * untouched.
 *
 * Each refusal is logged once, at warn, with the event name, method, canonical
 * path, correlation id, the number of query parameters and whether a
 * prototype-polluting name was among them — never the query text, a parameter
 * value or name, a header or a credential.
 *
 * ## What `skipProxyUrlNormalize` changes (read in the installed Next 16.3.8)
 *
 * - `runMiddleware` (`next/dist/server/next-server.js`) hands the proxy the
 *   request's `initURL` instead of a URL rebuilt from the parsed query.
 * - The flag is compiled into the server bundles as
 *   `__NEXT_NO_MIDDLEWARE_URL_NORMALIZE` (`next/dist/build/define-env.js`). In
 *   the proxy adapter (`next/dist/server/web/adapter.js`) it stops the flight
 *   headers being stripped and a proxy rewrite or redirect being rewritten;
 *   this proxy does neither. In `NextRequest` and `NextURL` it keeps the input
 *   URL instead of the re-formatted one and skips `/_next/data` parsing; those
 *   differ only with a base path, locales or `trailingSlash`, none of which this
 *   application configures.
 * - `resolve-routes.js` consults it only when `trailingSlash` is set, which it
 *   is not, and the edge route-module branch that reads it serves no route here
 *   (no route declares the edge runtime).
 * - The URL a route handler reads is still rebuilt by `normalizeCdnUrl`, which
 *   does not consult the flag — which is why the in-route guards cannot see a
 *   `__proto__` key and this proxy exists.
 *
 * The proxy runs on the Node.js runtime (Next 16 `proxy.ts`; the build's
 * `functions-config-manifest.json` records `runtime: nodejs`), so the Node
 * logger is available. The in-route guards stay: they are what an in-process
 * caller meets. Nothing is read and no session is resolved before the refusal,
 * so the answer is the same with or without a credential.
 */
const SELF_READ_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/auth/session',
  '/api/v1/auth/working-context',
]);

const JUDGED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const PROTOTYPE_POLLUTING_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const ESCAPE = /%([0-9A-Fa-f]{2})/g;
const UNRESERVED = /^[A-Za-z0-9._~-]$/;

/**
 * The path as Next would route it, for comparison only.
 *
 * Decodes only an escape whose character is unreserved (RFC 3986 section 2.3:
 * equivalent to the character itself), so `%2F`, `%3B` and the like stay
 * escaped and a malformed `%` sequence is left as written; nothing here can
 * throw. The result is resolved again so a decoded dot segment is resolved too.
 */
export function canonicalPath(pathname: string): string {
  const decoded = pathname.replace(ESCAPE, (escape, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(character) ? character : escape;
  });
  const resolved = new URL(decoded.replace(/\/{2,}/g, '/'), 'http://canonical.invalid').pathname;
  return resolved.length > 1 && resolved.endsWith('/') ? resolved.slice(0, -1) : resolved;
}

export function proxy(request: NextRequest): Response {
  const url = new URL(request.url);
  const path = canonicalPath(url.pathname);
  const method = request.method.toUpperCase();
  if (!SELF_READ_PATHS.has(path) || !JUDGED_METHODS.has(method) || url.search === '') {
    return NextResponse.next();
  }

  const { correlationId } = normalizeInboundCorrelationId(request.headers.get(CORRELATION_HEADER));
  const names = [...url.searchParams.keys()];
  log.warn('proxy.self_read_query_refused', {
    correlationId,
    context: {
      method,
      path,
      queryParameterCount: names.length,
      prototypePollutingName: names.some((name) => PROTOTYPE_POLLUTING_NAMES.has(name)),
    },
  });
  const failure = new AppFailure('ERR-VAL-001', {
    message: 'Validation failed for query',
    safeDetails: { violations: [{ path: 'query', rule: 'unrecognized_keys' }] },
  });
  return new Response(JSON.stringify(problemFor(failure, correlationId)), {
    status: failure.status,
    headers: problemHeaders(failure, correlationId),
  });
}

/**
 * Every auth path, so the proxy runs for each spelling `canonicalPath` may
 * resolve to a self-read; the judgement above, not the matcher, decides.
 */
export const config = {
  matcher: ['/api/v1/auth/:path*'],
};
