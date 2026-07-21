/**
 * Cache eligibility matrix (P1-13 caching foundation).
 *
 * The executable half of the matrix documented in
 * `docs/standards/cache-eligibility-and-invalidation.md`. Categories are named
 * in `defineOperation({ cacheCategory })`, and `assertCacheable()` refuses a
 * prohibited one — so "we agreed not to cache authorization decisions" is a
 * failing call rather than a paragraph nobody re-reads.
 *
 * Four categories are permanently prohibited, each for a specific incident:
 *
 *  - `authorization` — a cached allow survives a revoked grant. Permission
 *    changes must take effect immediately; that is the entire promise of
 *    server-side authorization.
 *  - `entitlement` — a cached entitlement survives a downgraded subscription,
 *    which is a commercial and contractual problem, not just a technical one.
 *  - `financial-command` — command results are not reads. Replaying one from a
 *    cache invents a financial fact.
 *  - `restricted-data` — classified values do not enter a store with no RLS,
 *    no tenant isolation, and no retention rules.
 */

export type CacheCategoryName =
  | 'never'
  | 'platform-reference'
  | 'tenant-configuration'
  | 'tenant-read-model'
  | 'authorization'
  | 'entitlement'
  | 'financial-command'
  | 'restricted-data';

export interface CacheCategory {
  readonly name: CacheCategoryName;
  readonly allowed: boolean;
  /** Key scope required for this category. */
  readonly keyScope: 'none' | 'platform' | 'tenant' | 'tenant+company' | 'tenant+branch';
  /** Maximum TTL in seconds. `0` when caching is prohibited. */
  readonly maxTtlSeconds: number;
  /** Who invalidates, and on what event. */
  readonly invalidationOwner: string;
  /** Consistency the caller may assume. */
  readonly consistency: 'strong' | 'read-your-writes' | 'eventual' | 'n/a';
  readonly rationale: string;
}

export const CACHE_CATEGORIES: Readonly<Record<CacheCategoryName, CacheCategory>> = Object.freeze({
  never: {
    name: 'never',
    allowed: false,
    keyScope: 'none',
    maxTtlSeconds: 0,
    invalidationOwner: 'n/a',
    consistency: 'n/a',
    rationale: 'Explicitly not cacheable. The default for anything not yet assessed.',
  },
  'platform-reference': {
    name: 'platform-reference',
    allowed: true,
    keyScope: 'platform',
    maxTtlSeconds: 3_600,
    invalidationOwner: 'migration or platform configuration change',
    consistency: 'eventual',
    rationale:
      'Tenant-neutral structural reference (currencies, locales, timezones). Changes only by ' +
      'migration or approved platform configuration, so a long TTL is safe.',
  },
  'tenant-configuration': {
    name: 'tenant-configuration',
    allowed: true,
    keyScope: 'tenant',
    maxTtlSeconds: 300,
    invalidationOwner: 'the application service that writes the configuration',
    consistency: 'read-your-writes',
    rationale:
      'Settings and catalogues a tenant edits rarely and reads constantly. The writing service ' +
      'invalidates the namespace in the same request, so the editor sees their own change.',
  },
  'tenant-read-model': {
    name: 'tenant-read-model',
    allowed: true,
    keyScope: 'tenant+branch',
    maxTtlSeconds: 60,
    invalidationOwner: 'the mutating application service, by namespace',
    consistency: 'eventual',
    rationale:
      'Derived list and summary views. Short TTL because staleness is visible to users; every ' +
      'mutation must declare its invalidation namespace.',
  },
  authorization: {
    name: 'authorization',
    allowed: false,
    keyScope: 'none',
    maxTtlSeconds: 0,
    invalidationOwner: 'n/a',
    consistency: 'n/a',
    rationale:
      'A cached allow outlives a revoked grant, and a cached deny outlives a granted one. ' +
      'Permission decisions are evaluated in the database on every request.',
  },
  entitlement: {
    name: 'entitlement',
    allowed: false,
    keyScope: 'none',
    maxTtlSeconds: 0,
    invalidationOwner: 'n/a',
    consistency: 'n/a',
    rationale:
      'Entitlement is evaluated at command time against the effective plan version (BR-TEN-001). ' +
      'A cached entitlement survives a subscription change — a commercial defect, not just a ' +
      'technical one.',
  },
  'financial-command': {
    name: 'financial-command',
    allowed: false,
    keyScope: 'none',
    maxTtlSeconds: 0,
    invalidationOwner: 'n/a',
    consistency: 'n/a',
    rationale:
      'Command results are not reads. Idempotent replay is served from ' +
      'shared.idempotency_keys — a durable, tenant-scoped, audited record — never from a cache.',
  },
  'restricted-data': {
    name: 'restricted-data',
    allowed: false,
    keyScope: 'none',
    maxTtlSeconds: 0,
    invalidationOwner: 'n/a',
    consistency: 'n/a',
    rationale:
      'Values classified restricted in the personal-data registries never enter a store that has ' +
      'no RLS, no tenant isolation, and no retention enforcement.',
  },
});

export class CacheEligibilityError extends Error {
  public override readonly name = 'CacheEligibilityError';
}

/** Throws when the category prohibits caching, or the TTL exceeds its ceiling. */
export function assertCacheable(category: CacheCategoryName, ttlSeconds: number): void {
  const definition = CACHE_CATEGORIES[category];
  if (!definition.allowed) {
    throw new CacheEligibilityError(
      `Cache category "${category}" is not cacheable: ${definition.rationale}`
    );
  }
  if (ttlSeconds <= 0 || !Number.isFinite(ttlSeconds)) {
    throw new CacheEligibilityError('TTL must be a positive, finite number of seconds.');
  }
  if (ttlSeconds > definition.maxTtlSeconds) {
    throw new CacheEligibilityError(
      `TTL ${ttlSeconds}s exceeds the ${definition.maxTtlSeconds}s ceiling for "${category}".`
    );
  }
}
