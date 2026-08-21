import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import {
  ApiClient,
  CORRELATION_HEADER,
  FAILURE_MESSAGE_KEY,
  VIOLATION_FALLBACK_KEY,
  VIOLATION_KEY_PREFIX,
  assertBaseUrl,
  controlNameFor,
  failureMessageKey,
  fieldErrorsOf,
  violationKeysOf,
  violationMessageKey,
  type ApiFailure,
  type Violation,
} from '@/lib/api/client';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import { fromFailure } from '@/lib/forms/action-result';

/**
 * The session cookie, and nothing else about the client, is stubbed.
 *
 * `readSessionToken` reaches for `next/headers`, which has no request scope in a
 * unit run. Replacing it lets `authorizedClient()` build a REAL `ApiClient` so
 * the adapter cases below exercise the shipped contract decision and the shipped
 * header assembly, with only `fetch` swapped out. Stubbing `server-client`
 * itself — the usual shortcut — would replace the very object under test.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => ({ name, value: 'test-session-token' }) }),
}));

const BASE = 'https://api.example.test';

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// `vi.stubGlobal('fetch', …)` is used by the adapter cases at the end of this
// file. Left in place it would outlive them and silently serve every later run.
afterEach(() => {
  vi.unstubAllGlobals();
});

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

  /**
   * The two tests below used to run against a problem document **this repository
   * has never sent** (`P1-27-QA-002`).
   *
   * The first asserted `problem.errorCode`; the API emits `code`. The second
   * asserted `problem.errors` as a map of field to sentences; the API emits
   * `violations`, a list of `{ path, rule }` pairs carrying no prose at all.
   * Both passed, because both fixtures were written from the client's
   * declaration rather than from `apps/api/src/server/errors/problem.ts`. What
   * they proved was that the client agreed with itself.
   *
   * What that cost: `fieldErrorsOf` read `problem.errors`, so it returned `{}`
   * for every real validation failure, and no form in CRM or Vehicle could show
   * a field-level error. A green suite over an invented fixture is worse than no
   * suite, because it answers the question nobody asks again.
   *
   * The fixtures below are the real shape. Every field in them appears in
   * `ProblemDocument`, and no field of `ProblemDocument` is spelled differently.
   */
  it('keeps the problem document for a caller that needs the error code', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(403, {
        type: 'urn:rootlco:error:ERR-IAM-001',
        title: 'Permission denied',
        status: 403,
        code: 'ERR-IAM-001',
        correlationId: 'srv-corr-1',
        requiredPermissions: ['iam.role.read'],
      })
    );
    const result = (await clientWith(fetchImpl as never).get('/x')) as ApiFailure;
    expect(result.problem?.code).toBe('ERR-IAM-001');
    // Sent by the API and previously undeclared, so a caller could not read them
    // without a cast.
    expect(result.problem?.correlationId).toBe('srv-corr-1');
    expect(result.problem?.requiredPermissions).toEqual(['iam.role.read']);
  });

  it('flattens field violations for a form resolver, as translation keys', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(422, {
        type: 'urn:rootlco:error:ERR-VAL-001',
        title: 'Validation failed',
        status: 422,
        code: 'ERR-VAL-001',
        correlationId: 'srv-corr-2',
        violations: [
          { path: 'body.givenName', rule: 'too_small' },
          // A second complaint about the same control. The first wins.
          { path: 'body.givenName', rule: 'invalid_format' },
          { path: 'body.preferredLocale', rule: 'too_big' },
        ],
      })
    );
    const result = (await clientWith(fetchImpl as never).get('/x')) as ApiFailure;
    expect(fieldErrorsOf(result)).toEqual({
      givenName: 'form.violation.too_small',
      preferredLocale: 'form.violation.too_big',
    });
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

  it('passes an idempotent replay (200, no ETag) through untouched', async () => {
    // A replayed idempotent POST answers 200 — not the 201 the first attempt
    // got — and with NO ETag header, even for a create whose first answer
    // carried one (P1-28: `route-handler.ts` replays the recorded body and
    // status only). This client never reads an ETag at all: a record version
    // travels in the BODY when an operation publishes one, and the success
    // shape is closed. Pinned so a future convenience cannot quietly synthesise
    // a `recordVersion` from a header that is not there, which would hand a
    // guarded command an invented `If-Match`. The other half — that replay
    // responses STAY ETag-free on the wire — is the backend's to assert, and
    // is a future Backend-branch item, deliberately not asserted from here.
    const fetchImpl = vi.fn(async () => respond(200, { id: 'r-1', state: 'recorded' }));
    const result = await clientWith(fetchImpl as never).send<{
      id: string;
      state: string;
      recordVersion?: number;
    }>('POST', '/x', { a: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    // The body, verbatim — nothing merged in from headers, nothing invented.
    expect(result.data).toEqual({ id: 'r-1', state: 'recorded' });
    expect(result.data.recordVersion).toBeUndefined();
    // The success shape is exactly these four fields; a fifth would be the
    // fabrication this pin exists to refuse.
    expect(Object.keys(result).sort()).toEqual(['correlationId', 'data', 'ok', 'status']);
  });
});

describe('what a user may be told', () => {
  it('maps every failure kind to a translation key, never to server text', () => {
    // This comment used to warn against `problem.detail`. There is no such wire
    // field — the only prose the problem document carries is `title`, written
    // for a developer reading an error catalog and in English, in a product that
    // is Arabic-first. `title` is deliberately absent from this map, and the
    // point stands: what a user is shown is a key this application owns.
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

/**
 * `P1-27-QA-002` — the client's declared contract is now the real one.
 *
 * ## What was false
 *
 * `ProblemDetails` declared `detail`, `instance`, `errorCode` and
 * `errors: Record<string, string[]>`. The API — `apps/api/src/server/errors/problem.ts:25-44`
 * — publishes `type`, `title`, `status`, `code`, `correlationId`, and
 * optionally `violations`, `retryAfterSeconds`, `contract` and
 * `requiredPermissions`. Not one of the four declared extension fields exists on
 * the wire.
 *
 * `fieldErrorsOf` read `problem.errors`. It therefore returned `{}` for every
 * real 422 that has ever been sent, and no form in CRM or Vehicle could show a
 * field-level error. The old tests passed because their fixtures were copied
 * from the declaration.
 *
 * ## What these tests do differently
 *
 * Every fixture below is the shape `problemFor` builds. The rule tokens are
 * tokens that appear in `apps/api/src` — DERIVED from that tree at the end of
 * this file, not claimed here — and the paths are path forms that appear there:
 * `toViolations` joins the request part to the Zod path, so a bare `body` is real.
 */

const REAL_RULES = [
  'invalid_type',
  'too_small',
  'too_big',
  'required',
  'max_length',
  'not_found',
  'not_owned',
  'custom',
  'empty_patch',
  'unknown_reference',
  'unknown_currency',
  'unit_mismatch',
  'branch_company_mismatch',
  'invalid_format',
] as const;

function validationFailure(violations: readonly Violation[]): ApiFailure {
  return {
    ok: false,
    kind: 'validation',
    status: 422,
    problem: {
      type: 'urn:rootlco:error:ERR-VAL-001',
      title: 'Validation failed',
      status: 422,
      code: 'ERR-VAL-001',
      correlationId: 'corr-violation',
      violations,
    },
    correlationId: 'corr-violation',
  };
}

describe('a violation path names a control', () => {
  it.each([
    ['body.preferredLocale', 'preferredLocale'],
    ['body.contactPointId', 'contactPointId'],
    ['query.limit', 'limit'],
    ['query.branchId', 'branchId'],
    // `toViolations` joins the whole Zod path, so a nested or indexed field
    // arrives with its parents attached. The leaf is the control.
    ['body.contactPoints.0.value', 'value'],
    // Hand-thrown violations in the API sometimes carry no request part at all.
    ['sequenceCode', 'sequenceCode'],
    ['path.userId', 'userId'],
  ])('%s names the control %s', (path, control) => {
    expect(controlNameFor(path)).toBe(control);
  });

  it.each(['body', 'query', 'path', 'params'])(
    'a bare %s names no control, because it is about the whole request',
    (path) => {
      expect(controlNameFor(path)).toBeNull();
    }
  );
});

describe('a field violation reaches the right control with the right key', () => {
  it('maps the real path form to the control the form actually renders', () => {
    // `CustomerCreateScreen` reads `state.fieldErrors?.['preferredLocale']`. If
    // the key were `body.preferredLocale` the control would show nothing, which
    // is indistinguishable on screen from the empty map the old code returned.
    const failure = validationFailure([{ path: 'body.preferredLocale', rule: 'too_small' }]);
    expect(fieldErrorsOf(failure)).toEqual({ preferredLocale: 'form.violation.too_small' });
  });

  it('keeps the first violation per control and drops the rest, in wire order', () => {
    const failure = validationFailure([
      { path: 'body.givenName', rule: 'required' },
      { path: 'body.givenName', rule: 'too_big' },
      { path: 'body.familyName', rule: 'max_length' },
    ]);
    expect(fieldErrorsOf(failure)).toEqual({
      givenName: 'form.violation.required',
      familyName: 'form.violation.max_length',
    });
  });

  it('returns nothing for a failure that is not a validation failure', () => {
    const denied: ApiFailure = {
      ok: false,
      kind: 'forbidden',
      status: 403,
      problem: { code: 'ERR-IAM-001', requiredPermissions: ['crm.customer.write'] },
      correlationId: 'corr-denied',
    };
    expect(fieldErrorsOf(denied)).toEqual({});
    expect(violationKeysOf(denied).formKeys).toEqual([]);
  });

  it('never returns anything that is not a translation key', () => {
    // The API sends no prose in a violation, and nothing in this path may invent
    // any. A response that tries — an extra `message` field — must be ignored,
    // not rendered.
    const failure = validationFailure([
      { path: 'body.givenName', rule: 'too_small', message: '<b>Name is too short</b>' },
    ] as unknown as readonly Violation[]);
    for (const value of Object.values(fieldErrorsOf(failure))) {
      expect(value.startsWith(VIOLATION_KEY_PREFIX), value).toBe(true);
    }
  });
});

describe('a rule the catalogue does not carry falls back rather than leaking', () => {
  /**
   * The API emits well over eighty distinct rule tokens across eleven backend
   * modules and gains more each phase, so the catalogue cannot be exhaustive and
   * the fallback is the normal path, not the exceptional one.
   *
   * The token below is asserted to be absent from BOTH catalogues first. Without
   * that assertion this test would silently stop testing the fallback the day
   * someone added a message for it.
   */
  const UNCATALOGUED = 'unregistered_aggregate';

  it('is a rule no message file carries', () => {
    const key = `${VIOLATION_KEY_PREFIX}${UNCATALOGUED}`;
    expect(Object.keys(en)).not.toContain(key);
    expect(Object.keys(ar)).not.toContain(key);
  });

  it('maps it to the fallback key', () => {
    expect(violationMessageKey(UNCATALOGUED)).toBe(VIOLATION_FALLBACK_KEY);
    const failure = validationFailure([{ path: 'body.aggregate', rule: UNCATALOGUED }]);
    expect(fieldErrorsOf(failure)).toEqual({ aggregate: VIOLATION_FALLBACK_KEY });
  });

  it('maps a rule token that is a lookalike of a key, not a key', () => {
    // A response that sends `rule: 'invalid'` gets the fallback because the
    // catalogue happens to carry it; a response that sends something shaped like
    // a path must not be able to reach outside the namespace.
    expect(violationMessageKey('../../state.error.title')).toBe(VIOLATION_FALLBACK_KEY);
    expect(violationMessageKey('')).toBe(VIOLATION_FALLBACK_KEY);
  });
});

describe('a violation about the whole request is not swallowed', () => {
  it('surfaces at form level as the banner key', () => {
    // `empty_patch` — a save with nothing changed. It names no control, so
    // before this it was dropped and the operator saw a refusal with no reason.
    const failure = validationFailure([{ path: 'body', rule: 'empty_patch' }]);
    const keys = violationKeysOf(failure);
    expect(keys.fieldErrors).toEqual({});
    expect(keys.formKeys).toEqual(['form.violation.empty_patch']);

    const state = fromFailure(failure, 1);
    expect(state.status).toBe('invalid');
    expect(state.messageKey).toBe('form.violation.empty_patch');
    // One shape. No new field for a screen to forget to render — every form in
    // this phase already renders `messageKey`.
    expect(state.fieldErrors).toBeUndefined();
  });

  it('carries both halves when the response carries both', () => {
    const failure = validationFailure([
      { path: 'body', rule: 'empty_patch' },
      { path: 'body.givenName', rule: 'required' },
    ]);
    const state = fromFailure(failure, 2);
    expect(state.messageKey).toBe('form.violation.empty_patch');
    expect(state.fieldErrors).toEqual({ givenName: 'form.violation.required' });
  });

  it('still lets a deliberately uninformative override win', () => {
    // Sign-in. Every distinguishable failure there is an enumeration oracle, and
    // a whole-request violation leaking past the override would reopen it.
    const failure = validationFailure([{ path: 'body', rule: 'empty_patch' }]);
    expect(fromFailure(failure, 3, 'auth.signIn.failed').messageKey).toBe('auth.signIn.failed');
  });

  it('falls back to the generic banner when there is no whole-request violation', () => {
    const failure = validationFailure([{ path: 'body.givenName', rule: 'required' }]);
    expect(fromFailure(failure, 4).messageKey).toBe('form.formError');
  });
});

describe('every key this path can emit exists in both catalogues', () => {
  /**
   * Read from the message files, never from a list copied into this test. A
   * copied list would pass while the catalogue was empty, which is exactly the
   * failure this whole task is about.
   */
  const enKeys = new Set(Object.keys(en));
  const arKeys = new Set(Object.keys(ar));

  it('is not vacuous — the catalogue really does carry violation messages', () => {
    const namespaced = [...enKeys].filter((key) => key.startsWith(VIOLATION_KEY_PREFIX));
    expect(namespaced.length).toBeGreaterThanOrEqual(REAL_RULES.length + 1);
  });

  it('resolves the fallback in both languages', () => {
    expect(enKeys).toContain(VIOLATION_FALLBACK_KEY);
    expect(arKeys).toContain(VIOLATION_FALLBACK_KEY);
  });

  it.each(REAL_RULES)('%s resolves in both languages', (rule) => {
    const key = violationMessageKey(rule);
    // Not the fallback: each of these tokens is one a form can really produce,
    // so a generic message for it would be a silent downgrade.
    expect(key, `${rule} silently fell back`).toBe(`${VIOLATION_KEY_PREFIX}${rule}`);
    expect(enKeys, `${key} missing from en`).toContain(key);
    expect(arKeys, `${key} missing from ar`).toContain(key);
  });

  it('defines the same violation keys in both files, and no empty message', () => {
    const inEn = [...enKeys].filter((key) => key.startsWith(VIOLATION_KEY_PREFIX)).sort();
    const inAr = [...arKeys].filter((key) => key.startsWith(VIOLATION_KEY_PREFIX)).sort();
    expect(inAr).toEqual(inEn);
    for (const key of inEn) {
      expect(String((en as Record<string, string>)[key]).trim().length, key).toBeGreaterThan(0);
      expect(String((ar as Record<string, string>)[key]).trim().length, key).toBeGreaterThan(0);
      // The Arabic file must contain Arabic. A copy-paste that leaves the
      // English string behind reads as translated to anyone who does not read
      // Arabic and is invisible to a key-completeness check.
      expect(/[؀-ۿ]/.test(String((ar as Record<string, string>)[key])), key).toBe(true);
    }
  });

  it('emits nothing outside its own namespace, for any rule token at all', () => {
    for (const rule of [...REAL_RULES, 'unknown_thing', 'x', '__proto__', 'a.b.c']) {
      expect(violationMessageKey(rule).startsWith(VIOLATION_KEY_PREFIX), rule).toBe(true);
    }
  });
});

describe('a hostile response cannot reshape the result', () => {
  it('treats a __proto__ path as an ordinary control name', () => {
    const failure = validationFailure([
      { path: 'body.__proto__', rule: 'custom' },
      { path: 'body.givenName', rule: 'required' },
    ]);
    const errors = fieldErrorsOf(failure);
    expect(errors['givenName']).toBe('form.violation.required');
    // The prototype of a fresh object is untouched: nothing was written through
    // a setter.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['givenName']).toBeUndefined();
  });

  it('ignores a violation that is not two strings', () => {
    const failure = validationFailure([
      null,
      { path: 'body.givenName' },
      { rule: 'required' },
      { path: 42, rule: 'required' },
      { path: 'body.familyName', rule: 'required' },
    ] as unknown as readonly Violation[]);
    expect(fieldErrorsOf(failure)).toEqual({ familyName: 'form.violation.required' });
  });

  it('ignores violations that are not a list', () => {
    const failure: ApiFailure = {
      ok: false,
      kind: 'validation',
      status: 422,
      problem: { violations: 'nope' } as never,
      correlationId: 'corr-hostile',
    };
    expect(fieldErrorsOf(failure)).toEqual({});
  });
});

/**
 * P1-27-QA-004 — a conflict must say what actually happened.
 *
 * Every 409 used to render `state.conflict.title`, "Someone else changed this",
 * because `FAILURE_MESSAGE_KEY` maps a KIND and every 409 is one kind. The error
 * catalog defines ten codes at 409. The vehicle module raises `ERR-RES-002`
 * twelve times — a lifecycle state that refuses the write, a merged and read-only
 * vehicle, a candidate already decided, a unique index rejecting the row — and
 * none of those is another person editing the record.
 *
 * These cases drive a REAL request through the client, because the mapping is
 * only worth anything if it survives the path a screen actually takes.
 */
describe('P1-27-QA-004 — conflict copy follows the catalog code', () => {
  async function conflictState(problem: unknown) {
    const fetchImpl = vi.fn(async () => respond(409, problem));
    const failure = (await clientWith(fetchImpl as never).send(
      'PATCH',
      '/api/v1/vehicles/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      { colour: 'blue' }
    )) as ApiFailure;
    expect(failure.kind).toBe('conflict');
    return fromFailure(failure, 1);
  }

  const CONCURRENCY = 'state.conflict.title';
  const BLOCKED = 'state.conflict.blocked.title';

  it('keeps the concurrency sentence for the one code that means it', async () => {
    const state = await conflictState({
      type: 'urn:rootlco:error:ERR-CON-001',
      title: 'Record version conflict',
      status: 409,
      code: 'ERR-CON-001',
      correlationId: 'corr-con',
    });
    expect(state.status).toBe('conflict');
    expect(state.messageKey).toBe(CONCURRENCY);
  });

  it('does not claim a concurrent edit for a lifecycle or uniqueness refusal', async () => {
    const state = await conflictState({
      type: 'urn:rootlco:error:ERR-RES-002',
      title: 'Resource already exists',
      status: 409,
      code: 'ERR-RES-002',
      correlationId: 'corr-res',
    });
    expect(state.messageKey).toBe(BLOCKED);
    expect(state.messageKey).not.toBe(CONCURRENCY);
  });

  it('fails safe to the sentence that claims nothing when there is no code', async () => {
    const state = await conflictState({ status: 409, correlationId: 'corr-bare' });
    expect(state.messageKey).toBe(BLOCKED);
  });

  it('reaches the concurrency sentence from no other catalog code', async () => {
    /*
     * The set is DERIVED from the API's own catalog, not typed here.
     *
     * This list used to be nine codes a person wrote down. It happened to be
     * complete on the day it was written, which is the most dangerous state for
     * a hand-written list to be in: it passes, so nobody rechecks it, and the
     * next 409 the backend defines is silently outside the assertion. The
     * failure that would allow is exactly the one this describe exists to
     * prevent — a new conflict code inheriting "Someone else changed this".
     *
     * `conflictCodes()` reads `catalog.ts` and selects `status: 409`, so a code
     * added there joins this case without anybody remembering to add it.
     */
    const others = conflictCodes().filter((code) => code !== 'ERR-CON-001');
    // Anti-vacuity. A regex that stopped matching would produce an empty list
    // and a passing test that checked nothing.
    expect(others.length).toBeGreaterThanOrEqual(9);
    for (const code of others) {
      const state = await conflictState({ status: 409, code, correlationId: `corr-${code}` });
      expect(state.messageKey, `${code} must not claim a concurrent edit`).toBe(BLOCKED);
    }
  });

  it('publishes both sentences in both catalogues', () => {
    for (const key of [CONCURRENCY, BLOCKED, 'state.conflict.blocked.description']) {
      expect(Object.keys(en), `en is missing ${key}`).toContain(key);
      expect(Object.keys(ar), `ar is missing ${key}`).toContain(key);
      expect((en as Record<string, string>)[key]).not.toBe('');
      expect((ar as Record<string, string>)[key]).not.toBe((en as Record<string, string>)[key]);
    }
  });

  it('leaves the kind map itself pointing at the concurrency sentence, unread for conflicts', () => {
    // The map is still exported and still correct about every other kind. The
    // point of the change is that a CONFLICT no longer reads it, so a future
    // edit here cannot quietly restore the false claim.
    expect(FAILURE_MESSAGE_KEY.conflict).toBe(CONCURRENCY);
    expect(FAILURE_MESSAGE_KEY.validation).toBe('form.formError');
  });
});

/**
 * `P1-27-QA-002` — the client's error contract is DERIVED from the API's, not
 * agreed with it by hand.
 *
 * ## Why the cases above were not enough
 *
 * Everything before this point asserts against a fixture a person typed. Those
 * fixtures were corrected once already — they used to describe `detail`,
 * `instance`, `errorCode` and `errors`, none of which the API has ever sent —
 * and correcting them fixed the past, not the future. Rename `violations` in
 * `apps/api/src/server/errors/problem.ts` and every case above still passes: a
 * hand-written literal agrees with whatever the client believes and knows
 * nothing about what the API publishes. That was measured by doing it, not
 * assumed.
 *
 * ## What this does instead
 *
 * It reads both declarations off disk and compares the field sets. Neither list
 * is written down here; a copied list would be the same manual agreement that
 * rotted the last one, moved one indirection further away. A rename on either
 * side now fails a case that names the field.
 *
 * ## What it does NOT claim
 *
 * It compares NAMES and OPTIONALITY, not TypeScript types. Full type
 * equivalence needs a compiler, and `apps/api` and `apps/web` are separate
 * programs with separate `tsconfig`s. Names and optionality are what both
 * shipped defects were made of — `errorCode` for `code`, `errors` for
 * `violations` — and a check that catches those honestly is worth more than a
 * type-level one that does not exist.
 */

const REPO_ROOT = join(process.cwd(), '..', '..');
const API_PROBLEM_FILE = join(REPO_ROOT, 'apps', 'api', 'src', 'server', 'errors', 'problem.ts');
const API_CATALOG_FILE = join(REPO_ROOT, 'apps', 'api', 'src', 'server', 'errors', 'catalog.ts');
const API_ROUTES_DIR = join(REPO_ROOT, 'apps', 'api', 'src', 'app', 'api', 'v1');
const WEB_CLIENT_FILE = join(process.cwd(), 'src', 'lib', 'api', 'client.ts');
const CRM_FEATURE_DIR = join(process.cwd(), 'src', 'features', 'crm');
const VEHICLE_FEATURE_DIR = join(process.cwd(), 'src', 'features', 'vehicles');
const OPEN_DECISIONS_FILE = join(REPO_ROOT, 'docs', 'phase-1', 'phase-1-27', 'open-decisions.md');

/**
 * Every catalog code the API publishes at HTTP 409.
 *
 * Read out of `catalog.ts` rather than listed, for the reason given at the one
 * case that consumes it. The entry shape is `'ERR-XXX-NNN': { … status: N … }`,
 * and the closing brace is matched at its known two-space indentation so a
 * nested object inside an entry cannot end it early.
 */
function conflictCodes(): string[] {
  const source = withoutComments(readFileSync(API_CATALOG_FILE, 'utf8'));
  const entry = /'(ERR-[A-Z]+-\d+)'\s*:\s*\{([\s\S]*?)\n {2}\}/g;
  const codes: string[] = [];
  for (const match of source.matchAll(entry)) {
    const code = match[1];
    const body = match[2];
    if (code === undefined || body === undefined) continue;
    if (/\bstatus:\s*409\b/.test(body)) codes.push(code);
  }
  return codes;
}

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

interface AdapterWrite {
  readonly method: string;
  readonly path: string;
  readonly file: string;
}

/**
 * Every mutation the CRM and Vehicle adapters actually emit, read out of their
 * source.
 *
 * ## Why this is derived and not listed
 *
 * `p1-27-qa.test.ts` asserts eleven hand-written `[method, path]` pairs against
 * `requiresIdempotencyKey`. Eleven is not the number of writes this phase
 * performs — this derivation finds **twenty-three**, and the twelve it adds
 * include `PATCH /vehicles/{vehicleId}`, which is the single operation
 * `P1-27-INT-003` was raised about. A list a person maintains agrees with
 * whatever that person last remembered; it cannot notice a write somebody adds
 * next week, which is exactly when the omission costs something.
 *
 * ## The two call shapes, and the guard that stops a third appearing silently
 *
 * Most adapters call `client.send('POST', path, body)` with the method as a
 * literal at the call site. Two helpers take the path and supply the rest:
 * `write(previous, parse, 'PUT', path, key)` keeps its method at the call site
 * and so is read by the same pattern, while `writeVehicle(previous, parse, path,
 * key)` fixes `POST` inside the helper and is read separately.
 *
 * A third shape would be invisible to both patterns, so `sendCallSites` counts
 * every `client.send` in the two trees and the case below asserts the count is
 * accounted for. That is the difference between a derivation and a cleverer
 * hand-list.
 */
function adapterWrites(): AdapterWrite[] {
  const found = new Map<string, AdapterWrite>();
  const literal = /'(POST|PUT|PATCH|DELETE)'\s*,\s*(`[^`]*`|'[^']*')/g;
  const vehicleHelper = /writeVehicle[<(][\s\S]*?,\s*(`[^`]*`)/g;

  const normalize = (raw: string): string =>
    raw
      .slice(1, -1)
      // The two path builders, resolved to what they return.
      .replace(/\$\{base\([^}]*\)\}/g, '/api/v1/customers/CID')
      .replace(/\$\{vehicleBase\([^}]*\)\}/g, '/api/v1/vehicles/VID')
      // Any other interpolation is a single id segment.
      .replace(/\$\{[^}]*\}/g, 'ID');

  for (const file of [
    ...sourceFilesUnder(CRM_FEATURE_DIR),
    ...sourceFilesUnder(VEHICLE_FEATURE_DIR),
  ]) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(literal)) {
      const method = match[1];
      const raw = match[2];
      if (method === undefined || raw === undefined) continue;
      const path = normalize(raw);
      if (!path.startsWith('/api/v1/')) continue;
      found.set(`${method} ${path}`, { method, path, file });
    }
    for (const match of source.matchAll(vehicleHelper)) {
      const raw = match[1];
      if (raw === undefined) continue;
      const path = normalize(raw);
      if (!path.startsWith('/api/v1/')) continue;
      found.set(`POST ${path}`, { method: 'POST', path, file });
    }
  }
  return [...found.values()];
}

/** Every `client.send` call in the two feature trees, however it is shaped. */
function sendCallSites(): number {
  return [...sourceFilesUnder(CRM_FEATURE_DIR), ...sourceFilesUnder(VEHICLE_FEATURE_DIR)].reduce(
    (total, file) =>
      total + (withoutComments(readFileSync(file, 'utf8')).match(/client\.send[<(]/g) ?? []).length,
    0
  );
}

interface DeclaredField {
  readonly name: string;
  readonly optional: boolean;
}

/**
 * Source with comments removed, so PROSE about a field is never mistaken for the
 * field.
 *
 * Both files carry docblocks that name fields the code does not declare —
 * `client.ts` explains at length that `detail`, `instance`, `errorCode` and
 * `errors` are NOT on the wire — so a scanner that read those sentences as code
 * would report exactly the drift it exists to deny. This repository has made
 * that mistake before.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The text between the braces of `interface <name>`, or null if there is none. */
function interfaceBody(source: string, name: string): string | null {
  const declaration = new RegExp(`\\binterface\\s+${name}\\b`).exec(source);
  if (!declaration) return null;
  const open = source.indexOf('{', declaration.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The properties declared directly on an interface body.
 *
 * Depth is tracked over `{}`, `()` and `[]` so a member whose type is an inline
 * object contributes ONE field and not three — the API declares `violations` as
 * `readonly { readonly path: string; readonly rule: string }[]`, and a reader
 * that flattened it would invent `path` and `rule` as envelope fields and then
 * report drift against a client that correctly does not have them.
 *
 * `<>` is deliberately NOT tracked: an arrow type would leave `>` unbalanced and
 * drive the depth negative, and splitting a generic on its comma is harmless
 * because the tail of such a split matches no property name and is dropped.
 */
function membersOf(body: string): DeclaredField[] {
  const fragments: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if (character === '{' || character === '(' || character === '[') depth += 1;
    else if (character === '}' || character === ')' || character === ']') depth -= 1;
    if (depth === 0 && (character === ';' || character === ',' || character === '\n')) {
      fragments.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  fragments.push(current);

  const fields: DeclaredField[] = [];
  for (const fragment of fragments) {
    const match = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\??)\s*:/.exec(fragment);
    const name = match?.[1];
    if (name === undefined) continue;
    fields.push({ name, optional: match?.[2] === '?' });
  }
  return fields;
}

/** Every property of a named interface in a file on disk. Throws when absent. */
function declaredFields(file: string, name: string): DeclaredField[] {
  const body = interfaceBody(withoutComments(readFileSync(file, 'utf8')), name);
  if (body === null) throw new Error(`${file} declares no interface ${name}`);
  return membersOf(body);
}

function fieldNames(fields: readonly DeclaredField[]): string[] {
  return fields.map((field) => field.name).sort();
}

describe('the declaration reader is checked before it is believed', () => {
  const FIXTURE = [
    '/** A docblock naming a ghostField that is not declared. */',
    'export interface Sample {',
    '  // a line comment naming anotherGhost',
    '  readonly plain: string;',
    '  readonly maybe?: number;',
    '  readonly nested: readonly { readonly path: string; readonly rule: string }[];',
    '  readonly mapped: Record<string, string[]>;',
    '  readonly url: string; // https://example.test/keep-me',
    '}',
  ].join('\n');

  it('reads every member exactly once, including one whose type is an inline object', () => {
    const body = interfaceBody(withoutComments(FIXTURE), 'Sample');
    expect(body).not.toBeNull();
    expect(membersOf(body as string)).toEqual([
      { name: 'plain', optional: false },
      { name: 'maybe', optional: true },
      // `path` and `rule` belong to the NESTED type, not to `Sample`.
      { name: 'nested', optional: false },
      { name: 'mapped', optional: false },
      { name: 'url', optional: false },
    ]);
  });

  it('never reports a field that only a comment mentions', () => {
    const found = fieldNames(
      membersOf(interfaceBody(withoutComments(FIXTURE), 'Sample') as string)
    );
    expect(found).not.toContain('ghostField');
    expect(found).not.toContain('anotherGhost');
  });

  it('fails loudly when the interface it was asked for is not there', () => {
    // The failure mode that would matter most. If a rename made
    // `ProblemDocument` unfindable, an empty list would compare equal to another
    // empty list and every derivation below would pass on nothing.
    expect(() => declaredFields(API_PROBLEM_FILE, 'NoSuchInterface')).toThrow(/NoSuchInterface/);
  });

  it('is reading the real files, not a path that resolved to nothing', () => {
    expect(readFileSync(API_PROBLEM_FILE, 'utf8')).toContain('export interface ProblemDocument');
    expect(readFileSync(WEB_CLIENT_FILE, 'utf8')).toContain('export interface ProblemDetails');
  });
});

describe('P1-27-QA-002 — the client contract is derived from the API contract', () => {
  const apiDocument = declaredFields(API_PROBLEM_FILE, 'ProblemDocument');
  const webDetails = declaredFields(WEB_CLIENT_FILE, 'ProblemDetails');

  it('found a non-trivial declaration on both sides', () => {
    expect(apiDocument.length).toBeGreaterThanOrEqual(5);
    expect(webDetails.length).toBeGreaterThanOrEqual(5);
  });

  it('declares the SAME field names on both sides of the wire', () => {
    // The assertion both shipped defects would have failed: `errorCode` against
    // `code`, and `errors` against `violations`.
    expect(fieldNames(webDetails)).toEqual(fieldNames(apiDocument));
  });

  it('declares every field optional on the client, because the body is untrusted', () => {
    // The API guarantees `type`, `title`, `status`, `code` and `correlationId`
    // on every document it builds. The CLIENT parses whatever arrived, which may
    // be a proxy's error page. Required there, optional here — deliberately
    // asymmetric, so this is asserted rather than derived from the API side.
    expect(webDetails.filter((field) => !field.optional)).toEqual([]);
  });

  it('mirrors every conditionally sent field, and keeps it optional', () => {
    const conditional = apiDocument.filter((field) => field.optional).map((field) => field.name);
    // Anti-vacuity: the API really does have conditional fields today. If it
    // stopped having them, this case would pass by looping over nothing.
    expect(conditional.length).toBeGreaterThanOrEqual(3);
    for (const name of conditional) {
      const mirror = webDetails.find((field) => field.name === name);
      expect(mirror, `${name} is sent by the API and not declared by the client`).toBeDefined();
      expect(mirror?.optional, `${name} must be optional on the client`).toBe(true);
    }
  });

  it('derives the VIOLATION member type too, not only the envelope', () => {
    /*
     * The envelope check alone would miss the drift that actually cost a
     * feature. `fieldErrorsOf` reads `violation.path` and `violation.rule`; a
     * rename INSIDE the member type leaves `violations` spelled identically on
     * both sides and breaks every form's field-level error just as completely.
     *
     * The API declares the member inline, so it is read out of the
     * `ProblemDocument` body rather than from an interface of its own.
     */
    const body = interfaceBody(
      withoutComments(readFileSync(API_PROBLEM_FILE, 'utf8')),
      'ProblemDocument'
    ) as string;
    const inline = /\bviolations\??\s*:[^;\n]*?\{([^}]*)\}/.exec(body)?.[1];
    expect(inline, 'the API no longer declares violations as an inline object').toBeDefined();

    const apiViolation = membersOf(inline ?? '');
    expect(apiViolation.length).toBeGreaterThanOrEqual(2);
    expect(fieldNames(apiViolation)).toEqual(
      fieldNames(declaredFields(WEB_CLIENT_FILE, 'Violation'))
    );
  });

  it('reads, in running code, only fields the API actually sends', () => {
    /*
     * The bridge from "the declarations agree" to "the client works". Two
     * declarations can match perfectly while the implementation dereferences a
     * third name that is in neither — which is precisely what `fieldErrorsOf`
     * did with `problem.errors`. The names the code reads are collected from the
     * source and checked against the DERIVED set, never against a list typed
     * here.
     */
    const clientCode = withoutComments(readFileSync(WEB_CLIENT_FILE, 'utf8'));
    const declared = new Set(fieldNames(apiDocument));
    const read = [...clientCode.matchAll(/\bproblem\??\.([A-Za-z_$][\w$]*)/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]]
    );
    expect(read.length).toBeGreaterThan(0);
    for (const field of read) {
      expect(
        declared.has(field),
        `client.ts reads problem.${field}, which the API never sends`
      ).toBe(true);
    }
  });
});

/**
 * `P1-27-QA-004` — the concurrency semantics this phase ACTUALLY has.
 *
 * ## The determination, and the reading behind it
 *
 * `canonical-plan.md` §5.3 names the task "Concurrency **and** idempotency". It
 * names no mechanism, and the words "optimistic concurrency", "record version",
 * "If-Match" and "ETag" appear nowhere in that plan as a P1-27 deliverable. §10
 * — "What every Frontend task owes" — asks for "conflict **where applicable**",
 * and the qualifier is doing real work.
 *
 * §4 settles what may be done about it here: "**No new Backend feature
 * development is allowed inside the P1-27 Frontend branch.**" Registering a CRM
 * or Vehicle write `versionGuarded: true` is a Backend route declaration, a
 * repository predicate and a service signature. It cannot be done from
 * `apps/web` at all, and §4 forbids doing it from this branch.
 *
 * So the requirement this phase can discharge is TRUTHFULNESS about the
 * semantics that exist. The decision is recorded as `P1-27-OD-005` in
 * `open-decisions.md`, and the last case below binds this file to that entry so
 * the two cannot drift apart.
 *
 * ## The semantics, established against the API source rather than assumed
 *
 * The platform HAS a complete optimistic-concurrency mechanism —
 * `apps/api/src/server/db/concurrency.ts`, `ERR-CON-001` at 409, `ERR-CON-002`
 * at 428 — and forty route modules use it. **No CRM or Vehicle route is among
 * them.** Nothing under those routes reads `expectedVersion` either, so an
 * `If-Match` sent from here would be parsed and then discarded: worse than
 * absent, because it would look like protection.
 *
 * `ERR-CON-001` IS raised on these writes, and that is the nuance a flat "no
 * concurrency detection at all" gets wrong. But the version it guards on is one
 * the SERVICE read in the same transaction — `vehicle-write-service.ts` reads
 * `currentState` and then guards the UPDATE with it, and
 * `customer-governance-service.ts` does the same — so it catches a writer
 * landing inside the server's own SELECT→UPDATE window and cannot catch a lost
 * update across an operator's read → edit → submit cycle. From the client's
 * position that is last-writer-wins, which is what `P1-27-INT-009` records.
 */
describe('P1-27-QA-004 — the concurrency semantics are stated, not overstated', () => {
  /** Every API route module the P1-27 adapters actually write to. */
  function routeModulesUnderTest(): string[] {
    const roots = new Set(
      adapterWrites().flatMap((write) => {
        const segment = write.path.replace('/api/v1/', '').split('/')[0];
        return segment === undefined ? [] : [segment];
      })
    );
    expect(roots.size, 'no route roots derived from the adapters').toBeGreaterThanOrEqual(3);
    return [...roots].flatMap((root) => sourceFilesUnder(join(API_ROUTES_DIR, root)));
  }

  it('confirms the platform mechanism exists, so its absence here is a choice and not a gap in the reading', () => {
    // Anti-vacuity in the strongest form: had `versionGuarded` been renamed
    // platform-wide, every assertion below would pass by finding nothing.
    const guarded = sourceFilesUnder(API_ROUTES_DIR).filter((file) =>
      /versionGuarded:\s*true/.test(readFileSync(file, 'utf8'))
    );
    expect(guarded.length, 'no route declares versionGuarded at all').toBeGreaterThanOrEqual(20);
  });

  it('finds no CRM or Vehicle write registered version-guarded', () => {
    const modules = routeModulesUnderTest();
    expect(modules.length).toBeGreaterThanOrEqual(10);
    for (const file of modules) {
      expect(
        /versionGuarded:\s*true/.test(readFileSync(file, 'utf8')),
        `${file} is versionGuarded — the last-writer-wins statement in open-decisions.md P1-27-OD-005 is now false and must be retracted`
      ).toBe(false);
    }
  });

  it('finds no CRM or Vehicle route that would honour an If-Match even if one were sent', () => {
    // The sharper half. A route could read `expectedVersion` without declaring
    // itself guarded; none does, which is why sending the header from here would
    // not merely be useless but misleading.
    for (const file of routeModulesUnderTest()) {
      expect(
        readFileSync(file, 'utf8').includes('expectedVersion'),
        `${file} reads expectedVersion — a client could then guard, and P1-27-OD-005 must be revisited`
      ).toBe(false);
    }
  });

  it('sends no If-Match from any CRM or Vehicle adapter', () => {
    // The client half of the same statement. `ifMatch` is a real parameter of
    // `send`, and P1-26 administration adapters do use it against routes that
    // ARE guarded; the point is that no P1-27 adapter does.
    const offenders = [
      ...sourceFilesUnder(CRM_FEATURE_DIR),
      ...sourceFilesUnder(VEHICLE_FEATURE_DIR),
    ].filter((file) => /\bifMatch\b\s*:/.test(withoutComments(readFileSync(file, 'utf8'))));
    expect(offenders, 'a P1-27 adapter sends If-Match to a route that discards it').toEqual([]);
  });

  it('promises no detection it lacks: the concurrency sentence is reachable from one code only', () => {
    // The user-facing consequence, asserted over the DERIVED 409 set rather than
    // a sample. `state.conflict.title` is "Someone else changed this"; it must
    // be reachable from `ERR-CON-001`, which genuinely means it, and from
    // nothing else.
    expect((en as Record<string, string>)['state.conflict.title']).toBeDefined();
    const codes = conflictCodes();
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const code of codes) {
      const claimed = failureMessageKey({
        ok: false,
        kind: 'conflict',
        status: 409,
        problem: { code },
        correlationId: null,
      });
      expect(claimed === 'state.conflict.title', `${code}`).toBe(code === 'ERR-CON-001');
    }
  });

  it('binds the decision record, so the sentence cannot age out of agreement with the code', () => {
    /*
     * The gate. `open-decisions.md` `P1-27-OD-005` states that no P1-27 write is
     * version-guarded and that concurrent edits are last-writer-wins. That is a
     * claim about `apps/api` written in a document — precisely the shape of
     * statement this phase has repeatedly shipped as false.
     *
     * So the document must carry the entry, and the cases above must agree with
     * the repository. If a Backend phase later guards these routes, the two
     * cases above fail and this one names the document that must change with
     * them.
     */
    const decisions = readFileSync(OPEN_DECISIONS_FILE, 'utf8');
    expect(decisions).toContain('`P1-27-OD-005`');
    expect(decisions).toContain('last-writer-wins');
    expect(decisions).toContain('P1-27-INT-009');
    expect(decisions).toMatch(/\*\*Review by:\*\*\s*2026-11-30/);
    expect(decisions).toMatch(/\*\*Owner:\*\*/);
  });
});

/**
 * `P1-27-QA-004` — the idempotency half, derived and then proved on the wire.
 *
 * Three judges called the existing coverage *sampled* rather than *proved*, and
 * they were right twice over:
 *
 *  1. The set of writes was **eleven pairs a person typed**. The adapters emit
 *     twenty-three. The twelve missing include `PATCH /vehicles/{vehicleId}` —
 *     the operation `P1-27-INT-003` exists about — and `PUT
 *     /customers/{customerId}/status`, both of which answer `400 ERR-INT-002`
 *     before authorization if the key is ever dropped.
 *  2. Every assertion stopped at `requiresIdempotencyKey`, a pure function.
 *     That it returns `true` says nothing about whether a header reaches a
 *     request: `send` could stop defaulting it, or `#request` could stop
 *     writing it, and every one of those cases would still pass.
 *
 * So the set is derived from the adapters, and the last case drives a REAL
 * adapter through the REAL `ApiClient` with only `fetch` replaced, and reads the
 * header off the request that adapter actually produced.
 */
describe('P1-27-QA-004 — idempotency is derived from the adapters, not listed', () => {
  it('accounts for every client.send in the two feature trees', () => {
    // The completeness guard. Eleven direct literal-method sends plus the two
    // helper wrappers is thirteen; a new call shape moves this number and fails
    // here rather than quietly falling out of the derivation.
    expect(sendCallSites()).toBe(13);
  });

  it('derives more writes than the hand-written list contained', () => {
    const writes = adapterWrites();
    expect(writes.length).toBeGreaterThanOrEqual(23);
    const keys = writes.map((write) => `${write.method} ${write.path}`);
    // The four the hand-written list omitted, named so a regression is legible.
    expect(keys).toContain('PATCH /api/v1/vehicles/ID');
    expect(keys).toContain('PATCH /api/v1/vehicles/ID/status');
    expect(keys).toContain('PUT /api/v1/customers/CID/status');
    expect(keys).toContain('POST /api/v1/customers/individuals');
  });

  it('resolves every derived write to a published operation, so none relies on the fail-open', () => {
    /*
     * `requiresIdempotencyKey` returns `true` for an UNKNOWN path by design —
     * sending a spare header is cheap, omitting a required one breaks the
     * feature. That fail-open means a blanket "expect(true)" over these paths
     * would pass even if the generated table had resolved none of them.
     *
     * So resolution is asserted first, and the key decision is then compared to
     * the operation's own `idempotent` flag rather than to a constant.
     */
    for (const { method, path } of adapterWrites()) {
      const operation = resolveOperation(method, path);
      expect(operation, `${method} ${path} resolves to no published operation`).not.toBeNull();
      expect(
        requiresIdempotencyKey(method, path),
        `${method} ${path} disagrees with its published contract`
      ).toBe(operation?.idempotent);
    }
  });

  it('finds every derived write idempotent, which is why the key must be defaulted', () => {
    const notIdempotent = adapterWrites().filter(
      ({ method, path }) => resolveOperation(method, path)?.idempotent !== true
    );
    expect(notIdempotent).toEqual([]);
  });

  it('puts an idempotency-key on the wire for a request a real adapter produced', async () => {
    /*
     * The end-to-end case, and deliberately the vehicle PATCH: it is the
     * operation `P1-27-INT-003` was raised about, the one a method-based rule
     * gets wrong, and the one whose failure was invisible because the resulting
     * 400 rendered as a validation banner naming no field.
     *
     * Only `fetch` is replaced. `updateVehicleAction` is the shipped adapter,
     * `authorizedClient()` builds a real `ApiClient`, `send` makes the real
     * contract decision and `#request` assembles the real headers. The session
     * cookie is stubbed because `next/headers` has no request scope in a unit
     * run — that is the environment, not the contract under test.
     */
    const seen: Headers[] = [];
    const stub = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return respond(200, { vehicleId: 'v1', changedColumns: ['color'] });
    });
    vi.stubGlobal('fetch', stub);

    const { updateVehicleAction } = await import('@/features/vehicles/profile-api');
    const state = await updateVehicleAction(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      { color: 'blue' },
      {} as never
    );

    expect(state.status, 'the adapter did not reach the network').toBe('success');
    expect(stub).toHaveBeenCalledTimes(1);

    const headers = seen[0] as Headers;
    const key = headers.get('idempotency-key');
    expect(key, 'the vehicle PATCH reached the wire with no idempotency key').not.toBeNull();
    // 8–200 characters, per the backend's own bound. A UUID is 36.
    expect((key ?? '').length).toBeGreaterThanOrEqual(8);
    expect((key ?? '').length).toBeLessThanOrEqual(200);
    // The same request must NOT carry a version guard: this route discards it.
    expect(headers.get('if-match')).toBeNull();

    const [url] = stub.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/v1/vehicles/3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  it('puts no idempotency-key on a read a real adapter produced', async () => {
    // The other direction, through the same adapter module. A key on a GET is
    // harmless today, but the contract says reads carry none and an assertion
    // that only ever checks the positive case cannot see a regression to
    // "always send".
    const seen: Headers[] = [];
    const stub = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return respond(200, { id: 'v1' });
    });
    vi.stubGlobal('fetch', stub);

    const { readVehicle } = await import('@/features/vehicles/profile-api');
    await readVehicle('3f2504e0-4f89-41d3-9a0c-0305e82c3301');

    expect(stub).toHaveBeenCalled();
    expect((seen[0] as Headers).get('idempotency-key')).toBeNull();
  });
});

/**
 * `P1-27-QA-002` — the provenance of `REAL_RULES`, derived rather than asserted.
 *
 * ## What was unguarded
 *
 * `REAL_RULES` at `:473-488` is the table of rule tokens this client translates
 * to a SPECIFIC message rather than to the fallback. Its whole value rests on
 * those tokens being ones the API really emits. That was stated in the docblock
 * above the table and checked nowhere: the only executing assertion resolved
 * each token against `en.json` and `ar.json`, which are the two files whoever
 * adds a token edits in the same commit. A token the catalogue carried and the
 * API never sent satisfied every case in this file.
 *
 * The gap ran in the harmless-looking direction — the table was TRUE when it was
 * written — which is why it survived. Nothing made it stay true.
 *
 * ## Why this sits at the END of the file
 *
 * `task-matrix.json` cites eight line ranges of this file. Inserting these cases
 * beside the table they are about renumbers six of them, and a citation that
 * slides onto a neighbouring `expect(` still passes the citation gate while
 * silently describing the wrong assertion. Appending costs a scroll and shifts
 * nothing.
 */

const API_SRC_DIR = join(REPO_ROOT, 'apps', 'api', 'src');

/**
 * The rule token in a violation the API writes as a literal, e.g.
 * `{ path: 'body.amount', rule: 'unknown_currency' }`.
 *
 * The token is captured WHOLE and compared by set membership. Both looser
 * readings are wrong here, and each is wrong in its own way:
 *
 * - A substring search over the tree is worthless. `custom` occurs on 1084 lines
 *   of `apps/api/src` and is emitted as a rule on 15 of them; `required` occurs
 *   on 311 and is emitted on 7. A fixture token would be "found" by the English
 *   prose of a docblock.
 * - A prefix match is barely better. `duplicate` is a strict prefix of the real
 *   `duplicate_code` and `duplicate_signature` and is itself never emitted, so
 *   anchoring the END of the token is what makes the negative cases below mean
 *   anything.
 */
const RULE_LITERAL = /\brule:\s*'([A-Za-z_][A-Za-z0-9_]*)'/g;

/**
 * The extraction, over one source text.
 *
 * Kept separate from the file walk so it can be run against a fixture. A
 * derivation that can only be pointed at the real tree is one whose own failure
 * modes go untested, and this one has exactly the failure mode that made the
 * check it replaces worthless.
 *
 * Comments are stripped first. Three API docblocks contain `rule:` followed by a
 * quoted identifier — one of them is prose about `dia.diagnostic_reviews` — and
 * they describe database triggers, not violations. This repository has read
 * prose as code repeatedly, so the fixture case states it rather than trusting
 * that it cannot happen.
 */
function ruleTokensIn(source: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of withoutComments(source).matchAll(RULE_LITERAL)) {
    if (match[1] !== undefined) tokens.add(match[1]);
  }
  return tokens;
}

/**
 * Every rule token `apps/api/src` emits as a literal.
 *
 * This is the set of tokens the API writes DOWN. It is NOT the complete set it
 * can emit: `toViolations` in `apps/api/src/server/http/validation.ts:16-22`
 * passes `issue.code` straight through, so every Zod code reaches the wire
 * without appearing as a literal anywhere. That makes membership here a
 * SUFFICIENT witness — it proves the API emits the token — and deliberately not
 * a complete one. Nothing below asks it to prove a token is unreachable; the
 * negative cases assert only that a token is not written as a literal, which is
 * all this can honestly show.
 */
function emittedRuleTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const file of sourceFilesUnder(API_SRC_DIR)) {
    for (const token of ruleTokensIn(readFileSync(file, 'utf8'))) tokens.add(token);
  }
  return tokens;
}

describe('P1-27-QA-002 — every rule token this client translates is one the API emits', () => {
  const emitted = emittedRuleTokens();

  it('read the API tree, and found a token vocabulary of the expected size', () => {
    // Anti-vacuity. An empty or near-empty set would make every membership case
    // below pass while asserting nothing — the same shape as a derivation that
    // reports no drift because it could not find what it was looking for.
    expect(emitted.size).toBeGreaterThanOrEqual(50);
  });

  it.each(REAL_RULES)('%s is emitted by apps/api, not merely translated by us', (rule) => {
    expect(
      emitted.has(rule),
      `${rule} is in REAL_RULES and has a message in en.json and ar.json, but nothing in ` +
        `apps/api/src emits it. Either the API stopped sending it, or it was never real.`
    ).toBe(true);
  });

  it.each([
    // Absent from the tree entirely. The baseline: the check can say no at all.
    ['nonexistent_rule_token', 'appears nowhere in the API'],
    // Emitted by nothing, but present in 68 files of `apps/api/src` as prose and
    // inside identifiers such as `tg_customer_approvals_immutable`. A substring
    // search — the obvious way to write this check — reports it as emitted.
    ['immutable', 'occurs throughout the API source but never as a rule'],
    // A strict prefix of the emitted `duplicate_code` and `duplicate_signature`.
    ['duplicate', 'is only a prefix of two real tokens'],
  ])('rejects %s, which %s', (token) => {
    expect(emitted.has(token)).toBe(false);
  });

  it('proves those negatives are about the RULE SHAPE and not about absence', () => {
    // Without this, the two cases above are indistinguishable from "the word is
    // not in the tree" — which a broken derivation would also satisfy.
    const tree = sourceFilesUnder(API_SRC_DIR)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(tree).toContain('immutable');
    expect(tree).toContain('duplicate');
    expect(tree).not.toContain('nonexistent_rule_token');
  });

  it('does not read a rule token out of a comment', () => {
    const FIXTURE = [
      "/** This layer's rule: `dia.diagnostic_reviews`, never rule: 'from_a_docblock'. */",
      "// A line comment claiming rule: 'from_a_line_comment'.",
      "const violation = { path: 'body.amount', rule: 'unknown_currency' };",
    ].join('\n');

    expect([...ruleTokensIn(FIXTURE)]).toEqual(['unknown_currency']);
  });

  it('reads a token that is written as a literal, however it is arranged', () => {
    // Anti-vacuity for the fixture above: it must be capable of finding things,
    // or "found only unknown_currency" proves nothing about comment stripping.
    expect([...ruleTokensIn("{ path: 'body', rule: 'empty_patch' }")]).toEqual(['empty_patch']);
    expect([...ruleTokensIn("{\n  rule:\n    'not_owned',\n}")]).toEqual(['not_owned']);
    // A non-literal is skipped rather than mis-read: the CRM services forward
    // `rule: error.rule` from the domain, and there is no token to take there.
    expect([...ruleTokensIn('{ path: error.path, rule: error.rule }')]).toEqual([]);
  });
});
