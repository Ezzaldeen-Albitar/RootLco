import { describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  CORRELATION_HEADER,
  FAILURE_MESSAGE_KEY,
  assertBaseUrl,
  fieldErrorsOf,
  type ApiFailure,
} from '@/lib/api/client';

const BASE = 'https://api.example.test';

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function clientWith(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  return new ApiClient({
    baseUrl: BASE,
    fetchImpl,
    newCorrelationId: () => 'fixed-correlation-id',
    ...options,
  });
}

describe('base URL validation', () => {
  it('accepts an absolute http(s) origin and trims a trailing slash', () => {
    expect(assertBaseUrl('https://api.example.test/')).toBe('https://api.example.test');
    expect(assertBaseUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api');
  });

  it.each([
    '',
    'api.example.test',
    '/api',
    'ftp://x.test',
    'https://x.test?a=1',
    'https://x.test#f',
  ])('refuses %s at construction rather than at the first request', (value) => {
    // A relative base silently sends every request to the WEB origin, which
    // returns HTML, and the failure surfaces as a JSON parse error far from
    // its cause.
    expect(() => assertBaseUrl(value)).toThrow();
  });
});

describe('the idempotency key', () => {
  /**
   * `P1-26-F-015`. Ten operations in this application's surface declare
   * `idempotent: true`, and the backend's route handler calls
   * `requireIdempotencyKey` unconditionally for each of them — **before**
   * permissions are evaluated — answering `ERR-INT-002` (400) without one.
   *
   * No call site supplied a key, so every invitation, every lifecycle change,
   * every role and permission edit, every approval limit and every settings
   * write failed 100% of the time. Nothing local could see it: the requirement
   * lives on the other side of a boundary no test in this repository crosses.
   */
  async function headersOf(
    method: 'POST' | 'PATCH' | 'DELETE',
    options?: { readonly idempotencyKey?: string }
  ): Promise<Headers> {
    let seen: Headers | undefined;
    const client = clientWith(async (_url, init) => {
      seen = new Headers(init?.headers);
      return respond(200, {});
    });
    await client.send(method, '/api/v1/x', { a: 1 }, options ?? {});
    return seen as Headers;
  }

  it('is attached to every POST', async () => {
    const headers = await headersOf('POST');
    const key = headers.get('idempotency-key');
    expect(key).toBeTruthy();
    // 8–200 characters, per the backend's own bounds.
    expect((key as string).length).toBeGreaterThanOrEqual(8);
    expect((key as string).length).toBeLessThanOrEqual(200);
  });

  it('is a fresh key per call, because one send is one logical attempt', async () => {
    // Correct only BECAUSE this client never retries a mutation. A caller that
    // wants to re-present the same attempt passes its own key.
    const first = (await headersOf('POST')).get('idempotency-key');
    const second = (await headersOf('POST')).get('idempotency-key');
    expect(first).not.toBe(second);
  });

  it('never overwrites a key the caller supplied', async () => {
    const headers = await headersOf('POST', { idempotencyKey: 'caller-supplied-key' });
    expect(headers.get('idempotency-key')).toBe('caller-supplied-key');
  });

  /**
   * This test used to read:
   *
   *   it('is NOT attached to PATCH or DELETE, which no operation marks
   *      idempotent', ...)
   *
   * **The premise was false** (`P1-27-INT-003`). The contract marks three PATCH
   * operations idempotent — `veh.vehicle-update`, `veh.vehicle-status-change`
   * and `svc.service-update` — plus six PUT. Each answered `400 ERR-INT-002`
   * before authorization, on every attempt.
   *
   * The test passed because it used the path `/api/v1/x`, which is not a
   * published operation, so it was really asserting the behaviour for an
   * *unknown* path — and then naming that assertion after a claim about the
   * whole contract. A green test and a confident sentence, neither of which had
   * looked at the contract.
   *
   * What it asserts now is the fail-safe for an unknown path, which is the thing
   * `/api/v1/x` actually exercises. The real per-operation behaviour is in
   * `tests/operation-contract.test.ts`, against the shipped table.
   */
  it('sends a key for an UNKNOWN mutation path, whatever the method', async () => {
    // Not conservatism — asymmetry. A key the operation ignores costs one unread
    // header; a key it required and did not get is a 400 on every attempt.
    expect((await headersOf('PATCH')).get('idempotency-key')).toBeTruthy();
    expect((await headersOf('DELETE')).get('idempotency-key')).toBeTruthy();
  });

  it('sends no key for a mutation the contract marks non-idempotent', async () => {
    let seen: Headers | undefined;
    const client = clientWith(async (_url, init) => {
      seen = new Headers(init?.headers);
      return respond(200, {});
    });
    // A real published operation — `shared.attachment-link-withdraw` — that is a
    // mutation and is NOT idempotent. Named from the shipped table rather than
    // invented, so the test cannot pass by resolving nothing.
    await client.send('DELETE', '/api/v1/attachments/links/abc');
    expect(seen?.get('idempotency-key')).toBeNull();
  });

  it('sends no key on login, which is a POST the contract does not mark idempotent', async () => {
    // The old POST-only rule attached a key here. It was harmless — the backend
    // ignores an unread header — but it is worth pinning: the new rule is
    // narrower than the old one, not merely wider, and this is where that shows.
    let seen: Headers | undefined;
    const client = clientWith(async (_url, init) => {
      seen = new Headers(init?.headers);
      return respond(200, {});
    });
    await client.send('POST', '/api/v1/auth/login', { email: 'a@b.test', password: 'x' });
    expect(seen?.get('idempotency-key')).toBeNull();
  });

  it('is not attached to a read', async () => {
    let seen: Headers | undefined;
    const client = clientWith(async (_url, init) => {
      seen = new Headers(init?.headers);
      return respond(200, {});
    });
    await client.get('/api/v1/x');
    expect(seen?.get('idempotency-key')).toBeNull();
  });
});

describe('the If-Match guard', () => {
  it('sends the version the caller supplied, and nothing when none is given', async () => {
    let seen: Headers | undefined;
    const client = clientWith(async (_url, init) => {
      seen = new Headers(init?.headers);
      return respond(200, {});
    });
    await client.send('PATCH', '/api/v1/x', { a: 1 }, { ifMatch: 7 });
    expect(seen?.get('if-match')).toBe('7');

    await client.send('PATCH', '/api/v1/x', { a: 1 });
    // Never defaulted. The backend refusing an unguarded update is the correct
    // failure; inventing a version here would turn the guard into a lost update.
    expect(seen?.get('if-match')).toBeNull();
  });
});

describe('successful requests', () => {
  it('returns typed data and the echoed correlation id', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(200, { status: 'ready' }, { [CORRELATION_HEADER]: 'server-id' })
    );
    const result = await clientWith(fetchImpl as never).get<{ status: string }>(
      '/api/v1/health/ready'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('ready');
    expect(result.correlationId).toBe('server-id');
  });

  it('sends a correlation id on every request', async () => {
    const fetchImpl = vi.fn(async () => respond(200, {}));
    await clientWith(fetchImpl as never).get('/api/v1/health/ready');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)[CORRELATION_HEADER]).toBe(
      'fixed-correlation-id'
    );
  });

  it('falls back to the id it sent when the server echoes none', async () => {
    const fetchImpl = vi.fn(async () => respond(200, {}));
    const result = await clientWith(fetchImpl as never).get('/api/v1/health/ready');
    expect(result.correlationId).toBe('fixed-correlation-id');
  });
});

describe('problem details are mapped to a kind', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
    [422, 'validation'],
    [429, 'rate-limited'],
    [500, 'server'],
    [503, 'unavailable'],
  ])('maps %i to %s', async (status, kind) => {
    const fetchImpl = vi.fn(async () => respond(status, { title: 'x', status }));
    const result = await clientWith(fetchImpl as never).get('/api/v1/health/ready', { retries: 0 });
    expect(result.ok).toBe(false);
    expect((result as ApiFailure).kind).toBe(kind);
  });

  it('keeps the problem document for a caller that needs the error code', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(403, { title: 'Forbidden', status: 403, errorCode: 'ERR-IAM-001' })
    );
    const result = (await clientWith(fetchImpl as never).get('/x')) as ApiFailure;
    expect(result.problem?.errorCode).toBe('ERR-IAM-001');
  });

  it('flattens field errors for a form resolver', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(422, {
        status: 422,
        errors: { name: ['Name is required', 'and too short'], amount: ['Not a decimal'] },
      })
    );
    const result = (await clientWith(fetchImpl as never).get('/x')) as ApiFailure;
    expect(fieldErrorsOf(result)).toEqual({ name: 'Name is required', amount: 'Not a decimal' });
  });

  it('returns no field errors for a non-validation failure, without a guard', async () => {
    const fetchImpl = vi.fn(async () => respond(403, {}));
    const result = (await clientWith(fetchImpl as never).get('/x')) as ApiFailure;
    expect(fieldErrorsOf(result)).toEqual({});
  });

  it('survives a malformed body rather than throwing', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    );
    const result = (await clientWith(fetchImpl as never).get('/x', { retries: 0 })) as ApiFailure;
    expect(result.kind).toBe('unavailable');
    expect(result.problem).toBeNull();
  });
});

describe('retry policy', () => {
  it('retries an idempotent read once on a transport failure', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('network');
      return respond(200, { ok: true });
    });
    const result = await clientWith(fetchImpl as never).get('/api/v1/health/ready');
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('does NOT retry a 403 — it will be a 403 again', async () => {
    const fetchImpl = vi.fn(async () => respond(403, {}));
    await clientWith(fetchImpl as never).get('/x');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('NEVER retries a mutation', async () => {
    // A retried POST that actually succeeded the first time creates a second
    // record. Idempotency keys exist so that retrying is a deliberate act.
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      throw new TypeError('network');
    });
    const result = await clientWith(fetchImpl as never).send('POST', '/x', { a: 1 });
    expect(result.ok).toBe(false);
    expect(calls, 'a mutation must be attempted exactly once').toBe(1);
  });

  it('caps the retry count so a brief outage is not amplified', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      throw new TypeError('network');
    });
    await clientWith(fetchImpl as never).get('/x', { retries: 99 });
    expect(calls).toBeLessThanOrEqual(3);
  });
});

describe('cancellation and timeout are different outcomes', () => {
  it('reports a caller cancellation as cancelled', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      controller.abort();
      throw Object.assign(new DOMException('aborted', 'AbortError'), { signal: init.signal });
    });
    const result = (await clientWith(fetchImpl as never).get('/x', {
      signal: controller.signal,
      retries: 0,
    })) as ApiFailure;
    expect(result.kind).toBe('cancelled');
  });

  it('reports our own timeout as a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    const result = (await clientWith(fetchImpl as never, { timeoutMs: 5 }).get('/x', {
      retries: 0,
    })) as ApiFailure;
    expect(result.kind).toBe('timeout');
  });
});

describe('mutations', () => {
  it('sends a JSON body and an idempotency key when given one', async () => {
    const fetchImpl = vi.fn(async () => respond(201, { id: 'x' }));
    await clientWith(fetchImpl as never).send('POST', '/x', { a: 1 }, { idempotencyKey: 'k-1' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('k-1');
  });

  it('sends credentials, because the session is a cookie on another origin', async () => {
    const fetchImpl = vi.fn(async () => respond(200, {}));
    await clientWith(fetchImpl as never).get('/x');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });
});

describe('what a user may be told', () => {
  it('maps every failure kind to a translation key, never to server text', () => {
    // `problem.detail` is server-authored and can name an internal path, a table
    // or a constraint. It is deliberately absent from this map.
    const kinds = [
      'unauthenticated',
      'forbidden',
      'not-found',
      'conflict',
      'validation',
      'rate-limited',
      'server',
      'unavailable',
      'timeout',
      'cancelled',
      'network',
    ] as const;
    for (const kind of kinds) {
      expect(FAILURE_MESSAGE_KEY[kind], kind).toMatch(/^(state|form)\./);
    }
  });
});
