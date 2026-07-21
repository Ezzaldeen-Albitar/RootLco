/**
 * The reference endpoint, end to end (P1-13-BE-021, P1-13-BE-007, P1-13-BE-008).
 *
 * `GET /api/v1/meta/ping` is the copyable exemplar, so what it proves is not
 * "ping works" — it is that the fixed pipeline order holds when a real HTTP
 * request meets a real database:
 *
 *   correlation → authenticate → resolve context → transaction → authorize →
 *   handler → response
 *
 * The three exits below are the three a client will actually meet, and each one
 * carries a property that is easy to lose in a refactor and invisible when lost:
 *
 *  - **401 with no authenticator installed.** P1-13 ships no login. The correct
 *    behaviour for a phase with no authentication is to fail closed on every
 *    authenticated operation, not to fall back to a default principal. A test
 *    that only covered the happy path would let a "convenient" default through.
 *  - **403 for an authenticated caller without the permission, carrying no
 *    data.** Authorization runs before the handler body, so a denied request must
 *    not return a partially-built document — not even the tenant reference it
 *    would have reported.
 *  - **200 with the correlation contract intact.** One identifier ties response
 *    header, response body, and logs together. A caller-proposed correlation ID
 *    is honoured only when it is a syntactically valid UUID; anything else is
 *    replaced and never echoed, because echoing unvalidated input into a header
 *    and a log line is where header injection and log forging start.
 *
 * `Cache-Control: no-store, private` is asserted because it is the CDN-readiness
 * contract: an authenticated response that becomes publicly cacheable is a
 * cross-tenant disclosure with no code change required to cause it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  IDENTITY_PROVIDER,
  SUBJECT_PERMITTED,
  SUBJECT_UNPERMITTED,
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { GET } from '@/app/api/v1/meta/ping/route';

const CORRELATION_HEADER = 'x-correlation-id';
const PING_URL = 'http://localhost/api/v1/meta/ping';

interface ProblemBody {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly requiredPermissions?: readonly string[];
}

interface PingBody {
  readonly status?: string;
  readonly tenantRef?: string;
  readonly effectiveScope?: string;
  readonly correlationId?: string;
  readonly observedAt?: string;
}

let admin: Pool;
let runtime: Pool;

function ping(headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(PING_URL, { method: 'GET', headers }));
}

function authenticateAs(providerSubject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('with no authenticator installed', () => {
  it('answers 401 with an ERR-IAM-002 problem document and a correlation id', async () => {
    __resetAuthenticatorForTests();

    const response = await ping();
    const body = (await response.json()) as ProblemBody;

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(body.code).toBe('ERR-IAM-002');
    expect(body.type).toBe('urn:rootlco:error:ERR-IAM-002');
    expect(body.status).toBe(401);

    const correlationId = response.headers.get(CORRELATION_HEADER);
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.correlationId).toBe(correlationId);
    // A failure is never a cacheable representation.
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('with an authenticated caller who lacks the permission', () => {
  it('answers 403 ERR-IAM-001 and returns no data at all', async () => {
    authenticateAs(SUBJECT_UNPERMITTED);

    const response = await ping();
    const body = (await response.json()) as ProblemBody & PingBody;

    expect(response.status).toBe(403);
    expect(body.code).toBe('ERR-IAM-001');
    expect(body.requiredPermissions).toEqual(['platform.meta.ping']);
    // Nothing the handler would have produced may appear on a denied request.
    expect(body.tenantRef).toBeUndefined();
    expect(body.effectiveScope).toBeUndefined();
    expect(body.status).toBe(403);
  });
});

describe('with the permitted caller', () => {
  it('answers 200 and echoes one correlation id in both the header and the body', async () => {
    authenticateAs(SUBJECT_PERMITTED);

    const response = await ping();
    const body = (await response.json()) as PingBody;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store, private');

    expect(body.status).toBe('ok');
    expect(body.tenantRef).toBe(TENANT_A);
    expect(body.effectiveScope).toBe('tenant');
    expect(typeof body.observedAt).toBe('string');

    const correlationId = response.headers.get(CORRELATION_HEADER);
    expect(correlationId).not.toBeNull();
    expect(body.correlationId).toBe(correlationId);
  });

  it('honours a caller-proposed correlation id when it is a valid UUID', async () => {
    authenticateAs(SUBJECT_PERMITTED);
    const proposed = randomUUID();

    const response = await ping({ [CORRELATION_HEADER]: proposed });
    const body = (await response.json()) as PingBody;

    expect(response.status).toBe(200);
    expect(response.headers.get(CORRELATION_HEADER)).toBe(proposed);
    expect(body.correlationId).toBe(proposed);
  });

  it('replaces an invalid inbound correlation id and never echoes it back', async () => {
    authenticateAs(SUBJECT_PERMITTED);
    // A payload a client could really send: header values may not contain a
    // newline (the platform rejects those before we see them), so the realistic
    // forgery is a plausible-looking string carrying markup.
    const forged = "not-a-uuid<script>alert('injected')</script>";

    const response = await ping({ [CORRELATION_HEADER]: forged });
    const body = (await response.json()) as PingBody;
    const issued = response.headers.get(CORRELATION_HEADER);

    expect(response.status).toBe(200);
    expect(issued).not.toBe(forged);
    expect(issued).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(body.correlationId).toBe(issued);
    expect(JSON.stringify(body)).not.toContain('injected');
  });

  it('replaces a nil UUID, which is well-formed but not a valid RFC 9562 identifier', async () => {
    authenticateAs(SUBJECT_PERMITTED);
    const nil = '00000000-0000-0000-0000-000000000000';

    const response = await ping({ [CORRELATION_HEADER]: nil });
    const body = (await response.json()) as PingBody;

    expect(response.status).toBe(200);
    expect(response.headers.get(CORRELATION_HEADER)).not.toBe(nil);
    expect(body.correlationId).toBe(response.headers.get(CORRELATION_HEADER));
  });

  it('reports the tenant it resolved server-side, not a tenant the caller named', async () => {
    // The claims name tenant B while the account lives in tenant A: the lookup
    // finds nothing and the request is denied rather than silently corrected.
    authenticateAs(SUBJECT_PERMITTED, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    const response = await ping();
    const body = (await response.json()) as ProblemBody;

    expect(response.status).toBe(401);
    expect(body.code).toBe('ERR-IAM-002');
  });
});
