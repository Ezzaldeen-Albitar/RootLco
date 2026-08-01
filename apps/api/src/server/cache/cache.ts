/**
 * Cache abstraction (P1-13 caching foundation).
 *
 * A port plus an in-process adapter. No external cache service is introduced:
 * adding Redis to satisfy a checklist would add an operational dependency, a
 * failure mode, and a second place tenant data lives, in exchange for nothing a
 * single-instance development deployment needs. `DistributedCache` is the
 * contract an adapter must satisfy when horizontal scaling actually arrives.
 *
 * Non-negotiable properties, enforced here rather than documented:
 *
 *  - **TTL is mandatory and finite.** `set()` requires `ttlSeconds`; there is no
 *    "cache forever" call to reach for at 2 a.m.
 *  - **Errors are never cached.** `getOrLoad()` caches only a fulfilled value; a
 *    rejected loader propagates and leaves the key empty, so a transient outage
 *    cannot be pinned into the cache for a TTL.
 *  - **A miss runs the same authorized path as a normal read.** The loader is
 *    supplied by the caller and executes inside the caller's context; the cache
 *    never queries the database itself, so it cannot bypass RLS.
 *  - **Stampede protection.** Concurrent misses on one key share one in-flight
 *    loader promise, so a cold key under load produces one database read, not N.
 *  - **Cache is never the source of truth.** There is no write-through and no
 *    write-behind: mutations write the database and then invalidate.
 */
import { metrics, METRICS } from '../observability/metrics';
import { backendConfig } from '../config/backend-config';

export interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAtMs: number;
  readonly version: number;
}

export interface CacheGetOptions {
  /** Skips the read but still populates on load. For read-after-write paths. */
  readonly bypass?: boolean;
}

export interface Cache {
  get<T>(key: string, options?: CacheGetOptions): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Removes every key beginning with `prefix`. Namespaced invalidation. */
  deleteNamespace(prefix: string): Promise<number>;
  /** Cache-aside with stampede protection. */
  getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    options?: CacheGetOptions
  ): Promise<T>;
  clear(): Promise<void>;
}

/** Marker for a shared adapter. Nothing implements it in P1-13. */
export interface DistributedCache extends Cache {
  readonly isShared: true;
}

export interface InMemoryCacheOptions {
  readonly maxEntries: number;
  readonly now?: () => number;
}

/**
 * Bounded in-process cache with LRU-ish eviction (oldest expiry first). Bounded
 * because an unbounded cache is a memory leak with good intentions.
 */
export class InMemoryCache implements Cache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryCacheOptions) {
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? (() => Date.now());
  }

  async get<T>(key: string, options: CacheGetOptions = {}): Promise<T | undefined> {
    if (options.bypass) return undefined;
    const entry = this.entries.get(key);
    if (!entry) {
      metrics().increment(METRICS.cacheMiss);
      return undefined;
    }
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      metrics().increment(METRICS.cacheMiss);
      return undefined;
    }
    metrics().increment(METRICS.cacheHit);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('Cache TTL must be a positive, finite number of seconds.');
    }
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = [...this.entries.entries()].sort(
        (a, b) => a[1].expiresAtMs - b[1].expiresAtMs
      )[0];
      if (oldest) this.entries.delete(oldest[0]);
    }
    this.entries.set(key, {
      value,
      expiresAtMs: this.now() + ttlSeconds * 1000,
      version: 1,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async deleteNamespace(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    options: CacheGetOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key, options);
    if (cached !== undefined) return cached;

    // Stampede protection: the first miss owns the load; concurrent misses await
    // the same promise instead of each running the loader.
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = (async () => {
      try {
        const value = await loader();
        // Only a fulfilled value is cached. A rejection leaves the key empty.
        await this.set(key, value, ttlSeconds);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, pending);
    return pending;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.inFlight.clear();
  }

  /** Test/diagnostics: current entry count. */
  size(): number {
    return this.entries.size;
  }
}

let instance: Cache | undefined;

export function cache(): Cache {
  if (!instance) {
    instance = new InMemoryCache({ maxEntries: backendConfig().CACHE_MAX_ENTRIES });
  }
  return instance;
}

export function setCache(next: Cache): void {
  instance = next;
}

export function __resetCacheForTests(options?: Partial<InMemoryCacheOptions>): InMemoryCache {
  const fresh = new InMemoryCache({
    maxEntries: options?.maxEntries ?? 1_000,
    ...(options?.now ? { now: options.now } : {}),
  });
  instance = fresh;
  return fresh;
}
