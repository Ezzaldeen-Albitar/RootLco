import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { canonicalPath, config, proxy } from '@api/proxy';
import { __resetLoggerForTests } from '@api/server/observability/logger';

/**
 * FRX1-c (P1-32-PRE-OD-INVF): the two authenticated self-reads take no query
 * parameter, and a lone `__proto__` key is refused before the framework drops it.
 *
 * Each case builds the request from the raw URL, which is what the proxy receives
 * once `skipProxyUrlNormalize` is set; the last block pins that setting, because
 * without it the proxy is handed a URL already missing the key.
 */
const ORIGIN = 'http://api.test';
const SELF_READS = ['/api/v1/auth/session', '/api/v1/auth/working-context'] as const;
const REFUSED_SEARCHES = [
  '?__proto__=x',
  '?constructor=x',
  '?%5F%5Fproto%5F%5F=x',
  '?=x',
  '?x',
  '?userId=00000000-0000-4000-8000-000000000001',
  '?__proto__=a&__proto__=b',
] as const;

interface Problem {
  readonly type: string;
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

// A refusal is logged; the records go nowhere unless a case captures them.
beforeEach(() => {
  __resetLoggerForTests({ write: () => undefined });
});
afterEach(() => {
  __resetLoggerForTests();
});

function requestFor(path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, { method, headers });
}

function passedThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

describe('self-read query proxy', () => {
  for (const path of SELF_READS) {
    for (const search of REFUSED_SEARCHES) {
      it(`refuses ${path}${search} with the route's validation problem`, async () => {
        const request = requestFor(`${path}${search}`);
        // The request really carries the raw key; the refusal is not vacuous.
        expect(new URL(request.url).search).toBe(search);

        const response = proxy(request);
        expect(passedThrough(response)).toBe(false);
        expect(response.status).toBe(422);
        expect(response.headers.get('content-type')).toBe('application/problem+json');
        expect(response.headers.get('cache-control')).toBe('no-store');
        const body = (await response.json()) as Problem;
        expect(body.code).toBe('ERR-VAL-001');
        expect(body.status).toBe(422);
        expect(body.type).toBe('urn:rootlco:error:ERR-VAL-001');
        expect(body.violations).toEqual([{ path: 'query', rule: 'unrecognized_keys' }]);
        expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
      });
    }

    it(`refuses a HEAD request to ${path} with a query`, () => {
      expect(proxy(requestFor(`${path}?__proto__=x`, 'HEAD')).status).toBe(422);
    });

    it(`passes ${path} through when no parameter is sent`, () => {
      expect(passedThrough(proxy(requestFor(path)))).toBe(true);
      expect(passedThrough(proxy(requestFor(`${path}?`)))).toBe(true);
    });

    it(`leaves a non-read method on ${path} to the route`, () => {
      expect(passedThrough(proxy(requestFor(`${path}?__proto__=x`, 'POST')))).toBe(true);
    });
  }

  it('keeps a valid inbound correlation id on the refusal', async () => {
    const correlationId = '7d3c2a1b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const response = proxy(
      requestFor('/api/v1/auth/session?__proto__=x', 'GET', { 'x-correlation-id': correlationId })
    );
    expect(((await response.json()) as Problem).correlationId).toBe(correlationId);
  });

  for (const path of [
    '/api/v1/auth/session/extra',
    '/api/v1/auth/login?__proto__=x',
    '/api/v1/iam/users?__proto__=x',
    '/api/v1/customers?limit=1',
  ]) {
    it(`passes ${path} through untouched`, () => {
      expect(passedThrough(proxy(requestFor(path)))).toBe(true);
    });
  }

  it('runs for every auth path, so each spelling of a self-read reaches the judgement', () => {
    expect([...config.matcher]).toEqual(['/api/v1/auth/:path*']);
  });

  it('is handed the URL as it arrived, so a __proto__ key is still there to refuse', () => {
    const source = readFileSync(join(REPOSITORY_ROOT, 'apps', 'api', 'next.config.ts'), 'utf8');
    expect(source).toMatch(/^\s*skipProxyUrlNormalize:\s*true,\s*$/m);
  });
});

describe('self-read spellings', () => {
  /*
   * Each spelling below either reached a self-read handler against a production
   * build (the dot-segment forms) or is equivalent to the canonical path under
   * RFC 3986 (an escaped unreserved character, a doubled or trailing slash).
   */
  const SPELLINGS: readonly (readonly [string, string])[] = [
    ['/api/v1/./auth/session', '/api/v1/auth/session'],
    ['/api/v1/auth/./session', '/api/v1/auth/session'],
    ['/api/v1/x/../auth/session', '/api/v1/auth/session'],
    ['/api/v1/auth/%2e/session', '/api/v1/auth/session'],
    ['/api/v1/auth/%2E/working-context', '/api/v1/auth/working-context'],
    ['/api/v1/auth/%73ession', '/api/v1/auth/session'],
    ['/api/v1/auth/sessi%6Fn', '/api/v1/auth/session'],
    ['/api/v1/auth/sessi%6fn', '/api/v1/auth/session'],
    ['/%61pi/v1/%61uth/session', '/api/v1/auth/session'],
    ['/api/v1/auth/working%2Dcontext', '/api/v1/auth/working-context'],
    ['/api/v1/auth/%77orking-context', '/api/v1/auth/working-context'],
    ['/api/v1/auth/session/', '/api/v1/auth/session'],
    ['/api/v1//auth//session', '/api/v1/auth/session'],
    ['//api/v1/auth/working-context', '/api/v1/auth/working-context'],
    ['/api/v1/auth/%2e%2e/auth/session', '/api/v1/auth/session'],
    ['/api/v1/auth/%252e/session', '/api/v1/auth/%252e/session'],
  ];

  for (const [spelling, canonical] of SPELLINGS) {
    it(`reads ${spelling} as ${canonical}`, () => {
      expect(canonicalPath(new URL(`${ORIGIN}${spelling}`).pathname)).toBe(canonical);
    });

    if (SELF_READS.includes(canonical as (typeof SELF_READS)[number])) {
      it(`refuses a query on ${spelling} exactly as on ${canonical}`, async () => {
        const response = proxy(requestFor(`${spelling}?__proto__=x`));
        expect(response.status).toBe(422);
        const body = (await response.json()) as Problem;
        expect(body.code).toBe('ERR-VAL-001');
        expect(body.violations).toEqual([{ path: 'query', rule: 'unrecognized_keys' }]);
      });

      it(`passes ${spelling} through without a query`, () => {
        expect(passedThrough(proxy(requestFor(spelling)))).toBe(true);
      });
    }
  }

  it('leaves an escape that is not an unreserved character as written', () => {
    expect(canonicalPath('/api/v1/auth%2Fsession')).toBe('/api/v1/auth%2Fsession');
    expect(canonicalPath('/api/v1/auth/session%3B')).toBe('/api/v1/auth/session%3B');
    expect(canonicalPath('/api/v1/auth/session%20')).toBe('/api/v1/auth/session%20');
  });

  it('never throws on a malformed escape, and does not turn it into a self-read', () => {
    for (const malformed of [
      '/api/v1/auth/session%',
      '/api/v1/auth/%E0%A4%Asession',
      '/api/v1/auth/session%zz',
      '/api/v1/auth/%c0%afsession',
    ]) {
      expect(() => canonicalPath(malformed)).not.toThrow();
      expect(passedThrough(proxy(requestFor(`${malformed}?__proto__=x`)))).toBe(true);
    }
  });

  for (const path of [
    '/API/v1/auth/session?__proto__=x',
    '/api/v1/auth/SESSION?__proto__=x',
    '/api/v1/auth/session;x?__proto__=x',
    '/api/v1/auth/session.json?__proto__=x',
    '/api/v1/auth/sessions?__proto__=x',
    '/api/v1/auth/session-x?__proto__=x',
    '/api/v1/auth/session/extra?__proto__=x',
    '/api/v1/auth/working-context/extra?__proto__=x',
    '/api/v1/auth/login?__proto__=x',
    '/api/v1/auth/logout?__proto__=x',
    '/api/v1/auth/password-reset?__proto__=x',
    '/api/v1/auth/password-reset/completion?__proto__=x',
    '/api/v1/auth?__proto__=x',
  ]) {
    it(`passes the neighbouring auth path ${path} through`, () => {
      expect(passedThrough(proxy(requestFor(path)))).toBe(true);
    });
  }
});

describe('refusal logging', () => {
  function captureLogs(): string[] {
    const lines: string[] = [];
    __resetLoggerForTests({ write: (line: string) => void lines.push(line) });
    return lines;
  }

  it('logs one warn record with only the classified fields', () => {
    const lines = captureLogs();
    const correlationId = '7d3c2a1b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const secretValue = 'needle-value-4f1d';
    const bearer = 'Bearer abcdefghijklmnopqrstuvwxyz0123456789';
    const response = proxy(
      requestFor(
        `/api/v1/auth/%73ession?__proto__=${secretValue}&tenantHint=${secretValue}`,
        'GET',
        {
          'x-correlation-id': correlationId,
          authorization: bearer,
          cookie: `sb-access=${secretValue}`,
        }
      )
    );
    expect(response.status).toBe(422);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(record['severity']).toBe('warn');
    expect(record['msg']).toBe('proxy.self_read_query_refused');
    expect(record['correlationId']).toBe(correlationId);
    expect(record['context']).toEqual({
      method: 'GET',
      path: '/api/v1/auth/session',
      queryParameterCount: 2,
      prototypePollutingName: true,
    });
    const raw = lines[0] as string;
    for (const forbidden of [
      secretValue,
      'tenantHint',
      '__proto__',
      '%73ession',
      'abcdefghij',
      'Bearer',
      'sb-access',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('records a query without a prototype-polluting name as such', () => {
    const lines = captureLogs();
    proxy(requestFor('/api/v1/auth/working-context?x', 'HEAD'));
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string) as { context: Record<string, unknown> };
    expect(record.context).toEqual({
      method: 'HEAD',
      path: '/api/v1/auth/working-context',
      queryParameterCount: 1,
      prototypePollutingName: false,
    });
  });

  it('logs nothing for a pass-through', () => {
    const lines = captureLogs();
    proxy(requestFor('/api/v1/auth/session'));
    proxy(requestFor('/api/v1/auth/login?__proto__=x'));
    proxy(requestFor('/api/v1/auth/session?__proto__=x', 'POST'));
    expect(lines).toEqual([]);
  });
});
