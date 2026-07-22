/**
 * Protects three properties that a rate limiter is worthless without.
 *
 *  1. **The window actually closes.** A limiter that never resets is an outage;
 *     one that resets early is not a limit. Both are asserted against an injected
 *     clock rather than wall time, because a timing-dependent test gets skipped.
 *  2. **Keys cannot be forged or shared.** Naive concatenation makes tenant `a` +
 *     user `bc` indistinguishable from tenant `ab` + user `c`, which lets one
 *     caller consume another's budget. Length-prefixed segments are the fix, and
 *     the collision pair below is the test that fails if someone "simplifies" it.
 *  3. **A process-local store is never mistaken for a distributed one.** Per-
 *     instance limiting is a materially weaker property than the one the policy
 *     claims, so the deployment gate must throw rather than warn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryRateLimitStore,
  RATE_LIMIT_POLICIES,
  assertStoreSuitableForMultiInstance,
  checkRateLimit,
  enforceRateLimit,
  rateLimitKey,
  rateLimitStore,
  setRateLimitStore,
  type RateLimitDimensions,
  type RateLimitPolicy,
  type RateLimitStore,
  __resetRateLimitForTests,
} from '@/server/http/rate-limit';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';

const WINDOW_MS = 60_000;

const POLICY: RateLimitPolicy = {
  name: 'unit-test-window',
  limit: 3,
  windowMs: WINDOW_MS,
  keyBy: ['operation', 'tenant', 'user'],
  securityRelevant: false,
  rationale: 'Synthetic policy used to prove window and key behaviour deterministically.',
};

const TENANT_A = '11111111-2222-4333-8444-555555555555';
const TENANT_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

const dimensionsFor = (tenantId: string): RateLimitDimensions => ({
  operation: 'meta.ping',
  tenantId,
  userId: USER,
});

/** Frozen clock the caller advances explicitly. */
function clockAt(nowMs: number): () => number {
  return () => nowMs;
}

async function captureFailure(run: () => Promise<unknown>): Promise<AppFailure> {
  try {
    await run();
  } catch (error) {
    if (isAppFailure(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw an AppFailure');
}

beforeEach(() => {
  __resetRateLimitForTests();
});

describe('window enforcement', () => {
  it('allows exactly the configured number of calls and throttles the next one', async () => {
    const start = 1_700_000_000_000;

    for (let call = 1; call <= POLICY.limit; call += 1) {
      const decision = await enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start));
      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(POLICY.limit);
      expect(decision.remaining).toBe(POLICY.limit - call);
    }

    const failure = await captureFailure(() =>
      enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start))
    );
    expect(failure.code).toBe('ERR-RTE-001');
    expect(failure.status).toBe(429);
    expect(failure.safeDetails.retryAfterSeconds).toBe(WINDOW_MS / 1_000);
  });

  it('resets once the window has elapsed', async () => {
    const start = 1_700_000_000_000;
    for (let call = 0; call < POLICY.limit; call += 1) {
      await enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start));
    }
    await expect(
      enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start))
    ).rejects.toBeInstanceOf(AppFailure);

    // One millisecond before the reset the bucket is still closed.
    await expect(
      enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start + WINDOW_MS - 1))
    ).rejects.toBeInstanceOf(AppFailure);

    const afterWindow = await enforceRateLimit(
      POLICY,
      dimensionsFor(TENANT_A),
      clockAt(start + WINDOW_MS)
    );
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(POLICY.limit - 1);
  });

  it('reports a decision without throwing, for callers that only observe', async () => {
    const start = 1_700_000_000_000;
    for (let call = 0; call < POLICY.limit; call += 1) {
      await checkRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start));
    }

    const decision = await checkRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start));
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('never lets one tenant exhaust another tenant’s budget', async () => {
    const start = 1_700_000_000_000;
    for (let call = 0; call < POLICY.limit; call += 1) {
      await enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start));
    }
    await expect(
      enforceRateLimit(POLICY, dimensionsFor(TENANT_A), clockAt(start))
    ).rejects.toBeInstanceOf(AppFailure);

    const tenantB = await enforceRateLimit(POLICY, dimensionsFor(TENANT_B), clockAt(start));
    expect(tenantB.allowed).toBe(true);
    expect(tenantB.remaining).toBe(POLICY.limit - 1);
  });
});

describe('key construction', () => {
  it('is collision-proof across dimension splits that naive concatenation would merge', () => {
    const split = (tenantId: string, userId: string) =>
      rateLimitKey(POLICY, { operation: 'meta.ping', tenantId, userId });

    // The classic bug: `tenant + user` is "abc" for both of these.
    expect(split('a', 'bc')).not.toBe(split('ab', 'c'));
  });

  it('is not forgeable by a caller who controls one segment’s content', () => {
    const honest = rateLimitKey(POLICY, {
      operation: 'meta.ping',
      tenantId: TENANT_A,
      userId: USER,
    });
    const forged = rateLimitKey(POLICY, {
      operation: 'meta.ping',
      tenantId: `${TENANT_A}|user:${USER.length}:${USER}`,
      userId: '',
    });
    expect(forged).not.toBe(honest);
  });

  it('separates tenants and policies', () => {
    expect(rateLimitKey(POLICY, dimensionsFor(TENANT_A))).not.toBe(
      rateLimitKey(POLICY, dimensionsFor(TENANT_B))
    );
    const otherPolicy: RateLimitPolicy = { ...POLICY, name: 'unit-test-other' };
    expect(rateLimitKey(POLICY, dimensionsFor(TENANT_A))).not.toBe(
      rateLimitKey(otherPolicy, dimensionsFor(TENANT_A))
    );
  });

  it('substitutes a placeholder for an absent dimension rather than collapsing the segment', () => {
    const key = rateLimitKey(POLICY, { operation: 'meta.ping', tenantId: null });
    expect(key).toContain('tenant:1:-');
    expect(key).toContain('user:1:-');
  });

  it('keys only on the dimensions the policy declares', () => {
    const ipPolicy = RATE_LIMIT_POLICIES['auth-adjacent']!;
    const key = rateLimitKey(ipPolicy, {
      operation: 'iam.sign-in',
      tenantId: TENANT_A,
      clientIp: '203.0.113.7',
    });
    expect(key).toContain('ip:11:203.0.113.7');
    expect(key).not.toContain('tenant:');
  });
});

describe('store suitability gate', () => {
  it('refuses a process-local store for a multi-instance deployment', () => {
    expect(rateLimitStore().isShared).toBe(false);
    expect(() => assertStoreSuitableForMultiInstance()).toThrow(/process-local/);
  });

  it('accepts a store that declares itself shared', () => {
    const shared: RateLimitStore = {
      isShared: true,
      hit: async (_key, windowMs, now) => ({ count: 1, resetAtMs: now + windowMs }),
      reset: async () => undefined,
    };
    setRateLimitStore(shared);
    expect(() => assertStoreSuitableForMultiInstance()).not.toThrow();
  });
});

describe('in-memory store', () => {
  it('counts within a window and starts a fresh bucket after it', async () => {
    const store = new InMemoryRateLimitStore();
    const first = await store.hit('k', WINDOW_MS, 1_000);
    expect(first).toEqual({ count: 1, resetAtMs: 1_000 + WINDOW_MS });

    const second = await store.hit('k', WINDOW_MS, 1_500);
    expect(second.count).toBe(2);
    expect(second.resetAtMs).toBe(1_000 + WINDOW_MS);

    const afterReset = await store.hit('k', WINDOW_MS, 1_000 + WINDOW_MS);
    expect(afterReset.count).toBe(1);
  });

  it('forgets a key on reset', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('k', WINDOW_MS, 1_000);
    await store.reset('k');
    expect((await store.hit('k', WINDOW_MS, 1_100)).count).toBe(1);
  });
});
