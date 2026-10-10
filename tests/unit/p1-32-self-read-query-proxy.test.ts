import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import { config, proxy } from '@api/proxy';

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

  it('is matched on exactly the two self-read paths', () => {
    expect([...config.matcher].sort()).toEqual([...SELF_READS].sort());
  });

  it('is handed the URL as it arrived, so a __proto__ key is still there to refuse', () => {
    const source = readFileSync(join(REPOSITORY_ROOT, 'apps', 'api', 'next.config.ts'), 'utf8');
    expect(source).toMatch(/^\s*skipProxyUrlNormalize:\s*true,\s*$/m);
  });
});
