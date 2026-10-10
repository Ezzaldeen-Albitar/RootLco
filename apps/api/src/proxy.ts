import { NextResponse, type NextRequest } from 'next/server';
import { AppFailure } from '@/server/errors/app-failure';
import { problemFor, problemHeaders } from '@/server/errors/problem';
import {
  CORRELATION_HEADER,
  normalizeInboundCorrelationId,
} from '@/server/observability/correlation';

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
 * it the URL as it arrived (`runMiddleware` in `next/dist/server/next-server.js`
 * otherwise rebuilds the proxy's URL from the same parsed query). So the raw
 * search string is the authority here: anything after `?` — `__proto__`,
 * `constructor`, an encoded name, `=x`, a bare `x` — is refused with the same
 * status and problem document the routes produce. A bare `?` carries no
 * parameter and is passed through, as the routes pass it.
 *
 * Only GET and HEAD on exactly those two paths are judged; every other request
 * passes through untouched. The in-route guards stay: they are what an
 * in-process caller meets, and this is the layer the framework does not strip.
 * Nothing is read and no session is resolved before the refusal, so the answer
 * is the same with or without a credential.
 */
const SELF_READ_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/auth/session',
  '/api/v1/auth/working-context',
]);

const JUDGED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

export function proxy(request: NextRequest): Response {
  const url = new URL(request.url);
  if (
    !SELF_READ_PATHS.has(url.pathname) ||
    !JUDGED_METHODS.has(request.method.toUpperCase()) ||
    url.search === ''
  ) {
    return NextResponse.next();
  }

  const { correlationId } = normalizeInboundCorrelationId(request.headers.get(CORRELATION_HEADER));
  const failure = new AppFailure('ERR-VAL-001', {
    message: 'Validation failed for query',
    safeDetails: { violations: [{ path: 'query', rule: 'unrecognized_keys' }] },
  });
  return new Response(JSON.stringify(problemFor(failure, correlationId)), {
    status: failure.status,
    headers: problemHeaders(failure, correlationId),
  });
}

export const config = {
  matcher: ['/api/v1/auth/session', '/api/v1/auth/working-context'],
};
