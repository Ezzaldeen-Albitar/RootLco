/**
 * Rate limiting (P1-13-SEC-003).
 *
 * Configuration-led, multi-dimensional, and explicitly **not** correct on a
 * process-local store once more than one instance runs. The store is a port; the
 * in-memory implementation is the development and test adapter, and
 * `DistributedRateLimitStore` is the contract a shared-store adapter must
 * satisfy before horizontal scaling is claimed. That distinction is enforced by
 * `assertStoreSuitableForMultiInstance()` rather than left to a comment.
 *
 * Keys are built centrally and are tenant-safe: a tenant identifier is always a
 * discrete key segment, so two tenants can never share a bucket, and a key can
 * never be forged by controlling one segment's content (segments are
 * length-prefixed, so `a|bc` and `ab|c` are different keys).
 *
 * The numeric limits below are **proposed validation baselines**, not approved
 * production targets. No load evidence exists (P1-OD-027 remains unresolved).
 */
import { AppFailure } from '../errors/app-failure';
import { metrics, METRICS } from '../observability/metrics';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly retryAfterSeconds: number;
}

/** Fixed-window counter contract. */
export interface RateLimitStore {
  /**
   * Increments the counter for `key` and returns the new count plus the window
   * expiry. Implementations must make increment-and-read atomic.
   */
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; resetAtMs: number }>;
  reset(key: string): Promise<void>;
  /** False for process-local stores. Gate for multi-instance deployment. */
  readonly isShared: boolean;
}

/**
 * In-memory fixed-window store. Correct for one process; bounded so a key-space
 * flood evicts rather than exhausts memory.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  readonly isShared = false;
  private static readonly MAX_KEYS = 50_000;
  private readonly buckets = new Map<string, { count: number; resetAtMs: number }>();

  async hit(
    key: string,
    windowMs: number,
    now: number
  ): Promise<{ count: number; resetAtMs: number }> {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAtMs <= now) {
      if (this.buckets.size >= InMemoryRateLimitStore.MAX_KEYS) {
        // Evict the oldest-resetting bucket. Bounded memory beats perfect accounting.
        const oldest = [...this.buckets.entries()].sort(
          (a, b) => a[1].resetAtMs - b[1].resetAtMs
        )[0];
        if (oldest) this.buckets.delete(oldest[0]);
      }
      const fresh = { count: 1, resetAtMs: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

/**
 * Marker interface for a shared store (Redis, PostgreSQL advisory counters, …).
 * No implementation ships in P1-13: introducing an external cache service is out
 * of scope, and a fake "distributed" store would be worse than none.
 */
export interface DistributedRateLimitStore extends RateLimitStore {
  readonly isShared: true;
}

/** Dimensions a policy may key on. */
export interface RateLimitDimensions {
  readonly operation: string;
  readonly tenantId?: string | null;
  readonly userId?: string | null;
  readonly sessionId?: string | null;
  readonly clientIp?: string | null;
}

export interface RateLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Which dimensions form the key. Order is fixed for key stability. */
  readonly keyBy: readonly ('operation' | 'tenant' | 'user' | 'session' | 'ip')[];
  /** Abuse-relevant breaches become security-event candidates. */
  readonly securityRelevant: boolean;
  /** Why this policy exists — read during review, not decoration. */
  readonly rationale: string;
}

/**
 * Proposed baselines. Every value is a starting point for measurement, not an
 * approved capacity statement.
 */
export const RATE_LIMIT_POLICIES: Readonly<Record<string, RateLimitPolicy>> = Object.freeze({
  'auth-adjacent': {
    name: 'auth-adjacent',
    limit: 10,
    windowMs: 60_000,
    keyBy: ['operation', 'ip'],
    securityRelevant: true,
    rationale:
      'Unauthenticated or authentication-adjacent operations are keyed by client IP because no ' +
      'trustworthy principal exists yet. Breach is a credential-stuffing signal.',
  },
  'expensive-read': {
    name: 'expensive-read',
    limit: 30,
    windowMs: 60_000,
    keyBy: ['operation', 'tenant', 'user'],
    securityRelevant: false,
    rationale:
      'Reports and wide searches. Keyed per user within a tenant so one operator cannot ' +
      'monopolise a tenant, and one tenant cannot monopolise the instance.',
  },
  'standard-command': {
    name: 'standard-command',
    limit: 120,
    windowMs: 60_000,
    keyBy: ['operation', 'tenant', 'user'],
    securityRelevant: false,
    rationale: 'General write path. Generous enough to be invisible to real use.',
  },
  /**
   * The only policy an unauthenticated (`public: true`) operation may use.
   *
   * A public route has no tenant and no user, so any policy keyed on either
   * collapses every caller in the world into one bucket — which throttles the
   * orchestrator's own probe as readily as an attacker, and lets one attacker
   * starve it. `route-handler.ts` substitutes this policy for a public
   * operation's declared one and enforces it BEFORE the handler, which is the
   * only place a public request can be throttled at all (P1-15-SR-004).
   */
  'public-probe': {
    name: 'public-probe',
    limit: 120,
    windowMs: 60_000,
    keyBy: ['operation', 'ip'],
    securityRelevant: false,
    rationale:
      'Unauthenticated health probes. Keyed by client address because no tenant or user exists; ' +
      'generous enough for an orchestrator polling every second, bounded enough that one source ' +
      'cannot make the probe itself the outage.',
  },
  'low-risk-metadata': {
    name: 'low-risk-metadata',
    limit: 600,
    windowMs: 60_000,
    keyBy: ['operation', 'tenant'],
    securityRelevant: false,
    rationale:
      'Cheap metadata reads. A limit exists only to bound accidental client loops; it is not a ' +
      'security control.',
  },
});

/**
 * Builds a collision-proof key. Segments are length-prefixed, so no combination
 * of segment contents can produce another policy's key.
 */
export function rateLimitKey(policy: RateLimitPolicy, dimensions: RateLimitDimensions): string {
  const parts: string[] = [`p:${policy.name}`];
  for (const dimension of policy.keyBy) {
    const value =
      dimension === 'operation'
        ? dimensions.operation
        : dimension === 'tenant'
          ? (dimensions.tenantId ?? '-')
          : dimension === 'user'
            ? (dimensions.userId ?? '-')
            : dimension === 'session'
              ? (dimensions.sessionId ?? '-')
              : (dimensions.clientIp ?? '-');
    parts.push(`${dimension}:${value.length}:${value}`);
  }
  return parts.join('|');
}

let store: RateLimitStore = new InMemoryRateLimitStore();

export function rateLimitStore(): RateLimitStore {
  return store;
}

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/**
 * Deployment gate. A multi-instance deployment with a process-local store does
 * not rate limit — it rate limits *per instance*, which is a different and much
 * weaker property. Call this from deployment composition.
 */
export function assertStoreSuitableForMultiInstance(): void {
  if (!store.isShared) {
    throw new Error(
      'Rate-limit store is process-local. A multi-instance deployment requires a shared store ' +
        'implementing DistributedRateLimitStore; the in-memory store is for single-process ' +
        'development and tests only.'
    );
  }
}

/** Injectable clock so window behaviour is deterministic under test. */
export type Clock = () => number;
const systemClock: Clock = () => Date.now();

/** Evaluates a policy. Returns the decision; the caller decides how to react. */
export async function checkRateLimit(
  policy: RateLimitPolicy,
  dimensions: RateLimitDimensions,
  clock: Clock = systemClock
): Promise<RateLimitDecision> {
  const now = clock();
  const key = rateLimitKey(policy, dimensions);
  const { count, resetAtMs } = await store.hit(key, policy.windowMs, now);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  return {
    allowed: count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds,
  };
}

/** Enforces a policy, throwing the cataloged throttling problem on breach. */
export async function enforceRateLimit(
  policy: RateLimitPolicy,
  dimensions: RateLimitDimensions,
  clock: Clock = systemClock
): Promise<RateLimitDecision> {
  const decision = await checkRateLimit(policy, dimensions, clock);
  if (decision.allowed) return decision;

  metrics().increment(METRICS.throttleCount, {
    policy: policy.name,
    operation: dimensions.operation,
  });
  throw new AppFailure('ERR-RTE-001', {
    message: `Rate limit "${policy.name}" exceeded`,
    safeDetails: { retryAfterSeconds: decision.retryAfterSeconds },
  });
}

export function __resetRateLimitForTests(): InMemoryRateLimitStore {
  const fresh = new InMemoryRateLimitStore();
  store = fresh;
  return fresh;
}
