import { describe, expect, it, vi } from 'vitest';
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
  fieldErrorsOf,
  violationKeysOf,
  violationMessageKey,
  type ApiFailure,
  type Violation,
} from '@/lib/api/client';
import { fromFailure } from '@/lib/forms/action-result';

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
 * tokens that appear in `apps/api/src`, and the paths are path forms that appear
 * there — `toViolations` joins the request part to the Zod issue path, so
 * `body.preferredLocale` and a bare `body` are both real.
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
