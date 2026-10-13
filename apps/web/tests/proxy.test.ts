import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { safeIntendedPath } from '@/features/authentication/api/intended-path';
import { REQUESTED_PATH_HEADER } from '@/features/authentication/api/requested-path-header';
import { config, proxy } from '@/proxy';

/**
 * The requested-path header `src/proxy.ts` writes (P1-32-PRE-OD-AUTHB-06).
 *
 * A protected render that sends an operator to sign in names the page it is
 * refusing from this header. Three things are held here:
 *
 *   1. the proxy records the request's PATH and never its query string;
 *   2. where the proxy runs, a copy of the header the client sent is replaced;
 *   3. the proxy does NOT run on every request — its matcher leaves a router
 *      prefetch out — so on those requests a client's own copy reaches the
 *      render as it was sent. That is why the header is untrusted input to its
 *      one reader, which passes it through `safeIntendedPath` (held at the
 *      reader in `session.test.ts`).
 *
 * Next carries the request headers a proxy rewrites on the response it returns:
 * one `x-middleware-request-<name>` per header, and the names it replaces in
 * `x-middleware-override-headers`. Those are read here; they are the installed
 * Next's own transport, so a release that renames them fails these cases
 * rather than passing them silently.
 */

const ORIGIN = 'http://localhost:3100';

function served(path: string, headers: Record<string, string> = {}): Response {
  return proxy(new NextRequest(`${ORIGIN}${path}`, { headers }));
}

/** The value of one request header as the render will receive it. */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

/** The request headers the proxy REPLACES rather than passes through. */
function replaced(response: Response): string[] {
  return (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

describe('the proxy records the path being served', () => {
  it.each([
    '/en/work-orders',
    '/ar/work-orders/2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e',
    '/en/platform/organizations',
    '/en',
  ])('records %s as it was asked for', (path) => {
    const response = served(path);
    expect(forwarded(response, REQUESTED_PATH_HEADER)).toBe(path);
    expect(replaced(response)).toContain(REQUESTED_PATH_HEADER);
  });

  it.each([
    ['a filter', '/en/work-orders?status=open', '/en/work-orders'],
    ['a search term', '/en/crm/customers?q=someone%40example.test', '/en/crm/customers'],
    ['an intended parameter of its own', '/en/invoices?intended=%2Fen%2Fpayments', '/en/invoices'],
    ['a page cursor', '/en/payments?cursor=abc&limit=50', '/en/payments'],
  ])('records the path and never the query string: %s', (_label, asked, expected) => {
    const recorded = forwarded(served(asked), REQUESTED_PATH_HEADER);
    expect(recorded).toBe(expected);
    expect(recorded).not.toContain('?');
    expect(recorded).not.toContain('=');
  });

  it('records what was asked without judging it: the reader decides what may travel', () => {
    // An API-shaped path and an encoded one are recorded like any other. The
    // proxy is not the check; `safeIntendedPath` at the reader is, and it
    // refuses both.
    for (const path of ['/api/v1/auth/session', '/reads/work-orders', '/en/%2F%2Fevil.example']) {
      const recorded = forwarded(served(path), REQUESTED_PATH_HEADER);
      expect(recorded).toBe(path);
      expect(safeIntendedPath(recorded)).toBeNull();
    }
  });
});

describe('where the proxy runs, a copy the client sent is replaced', () => {
  it.each([
    ['another page of the application', '/en/administration/users'],
    ['a protocol-relative address', '//evil.example'],
    ['a backslash address', '/\\evil.example'],
    ['an absolute address', 'https://evil.example/en/work-orders'],
    ['an API path', '/api/v1/auth/session'],
  ])('replaces %s with the path actually served', (_label, sent) => {
    const response = served('/en/work-orders', { [REQUESTED_PATH_HEADER]: sent });
    expect(forwarded(response, REQUESTED_PATH_HEADER)).toBe('/en/work-orders');
    // Replaced, not appended beside the client's: the name is in the list of
    // headers the render takes from the proxy, exactly once.
    expect(replaced(response).filter((name) => name === REQUESTED_PATH_HEADER)).toHaveLength(1);
  });
});

describe('the proxy does not run on every request, so the header is never authoritative', () => {
  const runsOn = (path: string, headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}`, headers });

  it('declares the exclusion in its matcher', () => {
    expect(config.matcher).toEqual([
      {
        source: '/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)',
        missing: [
          { type: 'header', key: 'next-router-prefetch' },
          { type: 'header', key: 'purpose', value: 'prefetch' },
        ],
      },
    ]);
  });

  it('runs on an ordinary request for a page, in either language', () => {
    expect(runsOn('/en/work-orders')).toBe(true);
    expect(runsOn('/ar/administration/users')).toBe(true);
    expect(runsOn('/en/login')).toBe(true);
  });

  it.each([
    ['a router prefetch', { 'next-router-prefetch': '1' }],
    ['a browser prefetch', { purpose: 'prefetch' }],
  ])('does not run on %s of the same page', (_label, headers) => {
    expect(runsOn('/en/work-orders', headers)).toBe(false);
  });

  it('does not run on a static asset', () => {
    expect(runsOn('/_next/static/chunks/main.js')).toBe(false);
    expect(runsOn('/favicon.svg')).toBe(false);
  });

  it('so a copy sent with a prefetch is NOT replaced, and only the reader stands between it and sign-in', () => {
    // The request the reviewer named: a prefetch of one page carrying the
    // header for another. The matcher leaves it out, so nothing rewrites the
    // header and the render receives the client's value.
    const spoofed = '/en/administration/users';
    expect(
      runsOn('/en/work-orders', { 'next-router-prefetch': '1', [REQUESTED_PATH_HEADER]: spoofed })
    ).toBe(false);
    // What the reader's check leaves of it: a page of this application passes,
    // which is no more than a hand-typed `?intended=` can name…
    expect(safeIntendedPath(spoofed)).toBe(spoofed);
    // …and nothing else does.
    expect(safeIntendedPath('//evil.example')).toBeNull();
    expect(safeIntendedPath('/\\evil.example')).toBeNull();
    expect(safeIntendedPath('/api/v1/auth/session')).toBeNull();
  });
});
