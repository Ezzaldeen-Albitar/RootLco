/**
 * Protects the cache properties that are security or correctness controls rather
 * than performance tuning.
 *
 * A cache is the easiest place in the system to serve one tenant's data to
 * another: someone writes `` `partner:${id}` ``, the tenant segment is missing,
 * and nothing fails until two tenants share an id space. Length-prefixed,
 * tenant-mandatory keys make that unexpressible — but only while the prefixing
 * survives refactoring, which is what the collision pair below pins down.
 *
 * The other three are incident-shaped: a cached error pins a transient outage in
 * place for a whole TTL; an unprotected stampede turns one cold key into N
 * database reads under load; and a cached authorization or entitlement decision
 * outlives the grant it was based on, which is the failure the eligibility matrix
 * exists to make impossible.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCache, cache, setCache, __resetCacheForTests } from '@/server/cache/cache';
import {
  SERIALIZATION_VERSION,
  platformKey,
  tenantKey,
  tenantNamespace,
  tenantOfKey,
} from '@/server/cache/keys';
import {
  CACHE_CATEGORIES,
  CacheEligibilityError,
  assertCacheable,
  type CacheCategoryName,
} from '@/server/cache/eligibility';

const TENANT_A = '11111111-2222-4333-8444-555555555555';
const TENANT_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';

/** Mutable clock so TTL behaviour is asserted, not slept through. */
let nowMs = 1_700_000_000_000;
const clock = () => nowMs;

let subject: InMemoryCache;

beforeEach(() => {
  nowMs = 1_700_000_000_000;
  subject = new InMemoryCache({ maxEntries: 64, now: clock });
});

describe('key isolation', () => {
  it('never lets two tenants share a key', () => {
    const forA = tenantKey({ module: 'crm', entity: 'partner', tenantId: TENANT_A });
    const forB = tenantKey({ module: 'crm', entity: 'partner', tenantId: TENANT_B });

    expect(forA).not.toBe(forB);
    expect(tenantOfKey(forA)).toBe(TENANT_A);
    expect(tenantOfKey(forB)).toBe(TENANT_B);
  });

  it('is collision-proof across segment splits that naive concatenation would merge', () => {
    const first = tenantKey({ module: 'a', entity: 'bc', tenantId: TENANT_A });
    const second = tenantKey({ module: 'ab', entity: 'c', tenantId: TENANT_A });
    expect(first).not.toBe(second);

    const parts = tenantKey({
      module: 'crm',
      entity: 'partner',
      tenantId: TENANT_A,
      parts: ['a', 'bc'],
    });
    const otherParts = tenantKey({
      module: 'crm',
      entity: 'partner',
      tenantId: TENANT_A,
      parts: ['ab', 'c'],
    });
    expect(parts).not.toBe(otherParts);
  });

  it('cannot be forged by a tenant id that contains the separator syntax', () => {
    const forged = tenantKey({
      module: 'crm',
      entity: 'partner',
      tenantId: `${TENANT_A}|p:1:x`,
    });
    const honest = tenantKey({
      module: 'crm',
      entity: 'partner',
      tenantId: TENANT_A,
      parts: ['x'],
    });

    expect(forged).not.toBe(honest);
    // The length prefix means the tenant segment is still read back exactly.
    expect(tenantOfKey(forged)).toBe(`${TENANT_A}|p:1:x`);
  });

  it('carries the serialization version and an environment namespace', () => {
    const key = tenantKey({ module: 'crm', entity: 'partner', tenantId: TENANT_A });
    expect(
      key.startsWith(`v:${String(SERIALIZATION_VERSION).length}:${SERIALIZATION_VERSION}|`)
    ).toBe(true);
    expect(key).toContain('|env:');
    expect(key).toContain('|mod:3:crm|');
  });

  it('separates company and branch scopes', () => {
    const base = { module: 'crm', entity: 'partner', tenantId: TENANT_A };
    const withCompany = tenantKey({ ...base, companyId: 'company-1' });
    const withBranch = tenantKey({ ...base, branchId: 'company-1' });

    expect(withCompany).not.toBe(tenantKey(base));
    expect(withCompany).not.toBe(withBranch);
  });

  it('names platform-scoped keys distinctly so choosing one is a deliberate act', () => {
    const key = platformKey({ module: 'shared', entity: 'currency' });
    expect(tenantOfKey(key)).toBe('-platform-');
    expect(key).not.toBe(tenantKey({ module: 'shared', entity: 'currency', tenantId: TENANT_A }));
  });

  it('produces a namespace that prefixes every key for that entity and tenant', () => {
    const namespace = tenantNamespace({ module: 'crm', entity: 'partner', tenantId: TENANT_A });
    const key = tenantKey({
      module: 'crm',
      entity: 'partner',
      tenantId: TENANT_A,
      parts: ['page-1'],
    });
    expect(key.startsWith(namespace)).toBe(true);
  });
});

describe('TTL discipline', () => {
  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'refuses a TTL of %p, because "cache forever" must not be reachable',
    async (ttl) => {
      await expect(subject.set('k', 'v', ttl)).rejects.toThrow(/positive, finite/);
    }
  );

  it('expires a value once its TTL has elapsed', async () => {
    await subject.set('k', 'value', 5);
    expect(await subject.get<string>('k')).toBe('value');

    nowMs += 4_999;
    expect(await subject.get<string>('k')).toBe('value');

    nowMs += 1;
    expect(await subject.get<string>('k')).toBeUndefined();
    // The expired entry is dropped, not merely hidden.
    expect(subject.size()).toBe(0);
  });

  it('honours a bypass read while still populating on load', async () => {
    await subject.set('k', 'cached', 60);
    expect(await subject.get<string>('k', { bypass: true })).toBeUndefined();

    const loaded = await subject.getOrLoad('k', 60, async () => 'fresh', { bypass: true });
    expect(loaded).toBe('fresh');
    expect(await subject.get<string>('k')).toBe('fresh');
  });
});

describe('cache-aside behaviour', () => {
  it('runs the loader exactly once under concurrent misses', async () => {
    let loads = 0;
    const loader = async (): Promise<string> => {
      loads += 1;
      await Promise.resolve();
      return 'loaded';
    };

    const results = await Promise.all(
      Array.from({ length: 16 }, () => subject.getOrLoad('hot', 60, loader))
    );

    expect(loads).toBe(1);
    expect(results.every((value) => value === 'loaded')).toBe(true);
    expect(await subject.get<string>('hot')).toBe('loaded');
  });

  it('never caches a rejection, so a transient outage cannot be pinned for a TTL', async () => {
    let attempts = 0;
    const failing = async (): Promise<string> => {
      attempts += 1;
      throw new Error('upstream unavailable');
    };

    await expect(subject.getOrLoad('k', 60, failing)).rejects.toThrow('upstream unavailable');
    await expect(subject.getOrLoad('k', 60, failing)).rejects.toThrow('upstream unavailable');

    expect(attempts).toBe(2);
    expect(subject.size()).toBe(0);

    // A later success is cacheable: the failure left no residue.
    expect(await subject.getOrLoad('k', 60, async () => 'recovered')).toBe('recovered');
    expect(await subject.get<string>('k')).toBe('recovered');
  });

  it('serves a cached value without calling the loader again', async () => {
    let loads = 0;
    const loader = async (): Promise<number> => {
      loads += 1;
      return loads;
    };

    expect(await subject.getOrLoad('k', 60, loader)).toBe(1);
    expect(await subject.getOrLoad('k', 60, loader)).toBe(1);
    expect(loads).toBe(1);
  });
});

describe('invalidation', () => {
  it('removes only the keys under the requested namespace', async () => {
    const namespace = tenantNamespace({ module: 'crm', entity: 'partner', tenantId: TENANT_A });
    const otherTenant = tenantNamespace({ module: 'crm', entity: 'partner', tenantId: TENANT_B });

    await subject.set(`${namespace}|p:6:page-1`, 'a', 60);
    await subject.set(`${namespace}|p:6:page-2`, 'b', 60);
    await subject.set(`${otherTenant}|p:6:page-1`, 'c', 60);

    const removed = await subject.deleteNamespace(namespace);

    expect(removed).toBe(2);
    expect(await subject.get(`${namespace}|p:6:page-1`)).toBeUndefined();
    expect(await subject.get<string>(`${otherTenant}|p:6:page-1`)).toBe('c');
  });

  it('deletes a single key and clears everything on request', async () => {
    await subject.set('a', 1, 60);
    await subject.set('b', 2, 60);

    await subject.delete('a');
    expect(subject.size()).toBe(1);

    await subject.clear();
    expect(subject.size()).toBe(0);
  });
});

describe('eligibility matrix', () => {
  it.each<CacheCategoryName>([
    'authorization',
    'entitlement',
    'financial-command',
    'restricted-data',
    'never',
  ])('refuses to cache the %s category at all', (category) => {
    expect(CACHE_CATEGORIES[category].allowed).toBe(false);
    expect(() => assertCacheable(category, 30)).toThrow(CacheEligibilityError);
    expect(() => assertCacheable(category, 30)).toThrow(/not cacheable/);
  });

  it.each<CacheCategoryName>(['platform-reference', 'tenant-configuration', 'tenant-read-model'])(
    'allows the %s category up to its ceiling and refuses one second beyond it',
    (category) => {
      const ceiling = CACHE_CATEGORIES[category].maxTtlSeconds;
      expect(() => assertCacheable(category, ceiling)).not.toThrow();
      expect(() => assertCacheable(category, ceiling + 1)).toThrow(/exceeds the/);
    }
  );

  it('refuses a non-positive or infinite TTL even for an allowed category', () => {
    expect(() => assertCacheable('tenant-configuration', 0)).toThrow(/positive, finite/);
    expect(() => assertCacheable('tenant-configuration', -1)).toThrow(/positive, finite/);
    expect(() => assertCacheable('tenant-configuration', Number.POSITIVE_INFINITY)).toThrow(
      /positive, finite/
    );
  });

  it('gives every prohibited category a zero ceiling, so no TTL can slip through', () => {
    for (const definition of Object.values(CACHE_CATEGORIES)) {
      if (!definition.allowed) {
        expect(definition.maxTtlSeconds).toBe(0);
        expect(definition.keyScope).toBe('none');
      } else {
        expect(definition.maxTtlSeconds).toBeGreaterThan(0);
      }
      expect(definition.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe('module-level instance', () => {
  it('is replaced by the test seam and by explicit installation', async () => {
    const fresh = __resetCacheForTests({ maxEntries: 8 });
    expect(cache()).toBe(fresh);

    const installed = new InMemoryCache({ maxEntries: 4 });
    setCache(installed);
    expect(cache()).toBe(installed);

    __resetCacheForTests();
  });
});
