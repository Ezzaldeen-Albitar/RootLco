/**
 * Whether a public route is throttled at all when no client address resolves
 * (PMR-006 / R-14).
 *
 * ## The gap this closes
 *
 * `handleOperation` skips the pre-authentication throttle for a **public**
 * operation whose policy keys on `ip` when `resolveClientAddress()` returns
 * null. The reason it exists is sound and is about the health probes: a policy
 * keyed on `ip` degrades to ONE GLOBAL BUCKET when there is no address, and a
 * shared bucket in front of a liveness probe is worse than no bucket — a hostile
 * caller exhausts it, the orchestrator's own probe starts receiving 429, and the
 * control causes the outage it exists to prevent.
 *
 * The skip was written against `operation.public`, which is not the property the
 * argument is about. Six operations are public, and four of them are the
 * unauthenticated `iam.auth-*` routes. `TRUSTED_PROXY_IPS` is empty by default
 * and no route passes a `peerAddress`, so in this deployment the address is
 * always null — which meant login, logout, password-reset and
 * password-reset-completion were throttled by **nothing**, while their own
 * `publicReason` text and this repository's security review both said they were
 * bounded at ten requests a minute with a security-relevant breach signal.
 *
 * Before P1-15 those four routes were enforced unconditionally (the pre-auth
 * branch had no skip), so the global bucket applied and the limit was real. The
 * skip therefore *removed* a control that the previous phase shipped.
 *
 * ## The rule now
 *
 * The skip is available only to a policy that is **not** `securityRelevant`.
 * `public-probe` (the health probes) keeps the exemption exactly as designed;
 * `auth-adjacent` never gets it. A security control is never silently dropped
 * for want of a key — it degrades to the coarsest bucket it can still form, and
 * that degradation is recorded in the risk register rather than hidden here.
 *
 * The residual availability exposure of the coarse bucket is real and is
 * recorded as R-14: with no client address, ten requests a minute are shared by
 * every caller of that operation, so a hostile caller can deny logins. That is
 * an availability failure, and it is preferred here over unbounded credential
 * stuffing on an unauthenticated credential endpoint. The actual fix for both is
 * a peer address supplied by the platform, which is infrastructure work.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleOperation } from '@/server/http/route-handler';
import { RATE_LIMIT_POLICIES, __resetRateLimitForTests } from '@/server/http/rate-limit';
import type { RegisteredOperation } from '@/server/auth/operation-registry';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';

/** A registration shaped just enough for the pipeline's public path. */
function op(overrides: Partial<RegisteredOperation>): RegisteredOperation {
  return {
    id: 'test.op',
    module: 'meta',
    method: 'POST',
    path: '/test',
    summary: 'test',
    permissions: [],
    scope: 'tenant',
    auditClass: 'none',
    public: false,
    ...overrides,
  } as RegisteredOperation;
}

/** Runs one request through the pipeline with no peer address at all. */
async function call(operation: RegisteredOperation): Promise<number> {
  const response = await handleOperation(
    operation,
    new Request('https://example.invalid/api/v1/test', { method: 'POST' }),
    async () => ({ body: { ok: true } })
  );
  return response.status;
}

/** Statuses for `count` sequential requests. */
async function callTimes(operation: RegisteredOperation, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) statuses.push(await call(operation));
  return statuses;
}

const AUTH_LOGIN = op({
  id: 'iam.auth-login',
  path: '/auth/login',
  public: true,
  publicReason: 'test',
  rateLimitPolicy: 'auth-adjacent',
});

const HEALTH_LIVE = op({
  id: 'shared.health-live',
  method: 'GET',
  path: '/health/live',
  public: true,
  publicReason: 'test',
  rateLimitPolicy: 'low-risk-metadata',
});

describe('P1-15 / public throttling when no client address resolves', () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    delete process.env.TRUSTED_PROXY_IPS;
    delete process.env.RATE_LIMIT_ENABLED;
    __resetBackendConfigForTests();
  });

  afterEach(() => {
    __resetRateLimitForTests();
    __resetBackendConfigForTests();
  });

  it('the default configuration really does resolve no client address', async () => {
    // The premise of the whole finding. If this ever stops holding, the
    // assertions below stop meaning what they say.
    const { backendConfig } = await import('@/server/config/backend-config');
    expect(backendConfig().TRUSTED_PROXY_IPS).toEqual([]);
    expect(backendConfig().RATE_LIMIT_ENABLED).toBe(true);

    const { resolveClientAddress } = await import('@/server/http/trusted-proxy');
    expect(resolveClientAddress({ headers: new Headers() }).ip).toBeNull();
  });

  it('an unauthenticated auth route is still throttled with no address to key on', async () => {
    const policy = RATE_LIMIT_POLICIES['auth-adjacent']!;
    const statuses = await callTimes(AUTH_LOGIN, policy.limit + 2);

    expect(statuses.slice(0, policy.limit)).toEqual(Array(policy.limit).fill(200));
    // The two past the limit are refused. Against the unnarrowed skip every one
    // of these is 200, which is what makes this a regression lock.
    expect(statuses.slice(policy.limit)).toEqual([429, 429]);
  });

  it('all four unauthenticated auth operations behave the same way', async () => {
    for (const id of [
      'iam.auth-login',
      'iam.auth-logout',
      'iam.auth-password-reset',
      'iam.auth-password-reset-completion',
    ]) {
      __resetRateLimitForTests();
      const statuses = await callTimes(
        op({
          id,
          path: `/${id}`,
          public: true,
          publicReason: 'test',
          rateLimitPolicy: 'auth-adjacent',
        }),
        11
      );
      expect(
        statuses.filter((status) => status === 429),
        id
      ).toHaveLength(1);
    }
  });

  it('a health probe keeps its exemption, because the shared bucket is the outage', async () => {
    // `low-risk-metadata` is tenant-keyed, so `policyFor` substitutes
    // `public-probe` — which is ip-keyed and NOT security-relevant, so the skip
    // still applies and the probe is never throttled without an address.
    const statuses = await callTimes(HEALTH_LIVE, RATE_LIMIT_POLICIES['public-probe']!.limit + 5);
    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('the exemption is decided by security relevance, not by the route being public', () => {
    expect(RATE_LIMIT_POLICIES['auth-adjacent']!.securityRelevant).toBe(true);
    expect(RATE_LIMIT_POLICIES['public-probe']!.securityRelevant).toBe(false);
    // Both key on ip; only the policy's security relevance separates them.
    expect(RATE_LIMIT_POLICIES['auth-adjacent']!.keyBy).toContain('ip');
    expect(RATE_LIMIT_POLICIES['public-probe']!.keyBy).toContain('ip');
  });

  it('a resolvable address keys the bucket per client, so the coarse bucket is only the fallback', async () => {
    process.env.TRUSTED_PROXY_IPS = '203.0.113.9';
    __resetBackendConfigForTests();

    const statuses: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const response = await handleOperation(
        AUTH_LOGIN,
        new Request('https://example.invalid/api/v1/auth/login', {
          method: 'POST',
          // Distinct client per request, forwarded by the trusted proxy.
          headers: { 'x-forwarded-for': `198.51.100.${index}` },
        }),
        async () => ({ body: { ok: true } }),
        { peerAddress: '203.0.113.9' }
      );
      statuses.push(response.status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('one client that keeps knocking is throttled even though others are not', async () => {
    process.env.TRUSTED_PROXY_IPS = '203.0.113.9';
    __resetBackendConfigForTests();

    const from = async (clientIp: string): Promise<number> => {
      const response = await handleOperation(
        AUTH_LOGIN,
        new Request('https://example.invalid/api/v1/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': clientIp },
        }),
        async () => ({ body: { ok: true } }),
        { peerAddress: '203.0.113.9' }
      );
      return response.status;
    };

    const noisy: number[] = [];
    for (let index = 0; index < 11; index += 1) noisy.push(await from('198.51.100.7'));
    expect(noisy.at(-1)).toBe(429);
    // A different client is unaffected — the bucket is per address.
    expect(await from('198.51.100.8')).toBe(200);
  });
});
