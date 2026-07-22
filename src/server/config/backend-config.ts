/**
 * Backend runtime configuration (P1-13-BE-003, scalability readiness).
 *
 * Everything the foundation can be tuned by lives here, validated once at first
 * use, with bounded defaults. Two rules:
 *
 *  1. **Secrets are read, never logged.** `describe()` in `src/config/env.ts`
 *     already establishes the "name the variable, never the value" convention;
 *     the same rule applies to everything below.
 *  2. **Every limit has a default and an upper bound.** An unbounded pool, an
 *     unbounded worker batch, or an unbounded page size is how a single bad
 *     request takes down an instance.
 *
 * Read-replica routing is *configurable but inert*: `DATABASE_REPLICA_URL` is
 * accepted so deployment topology can be expressed, and the repository layer
 * refuses to route a strongly-consistent operation to it (see `pool.ts`). No
 * replica is provisioned (ADR-012) and none is claimed.
 */
import { z } from 'zod';

/** Positive integer within an explicit range, with a default. */
const bounded = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const schema = z.object({
  /**
   * Primary PostgreSQL connection. The login role must be a member of
   * `app_runtime` (never an owner, never BYPASSRLS) — asserted at preflight.
   */
  DATABASE_URL: z.string().min(1).optional(),
  /** Optional read-replica DSN. Accepted, validated, and deliberately unused. */
  DATABASE_REPLICA_URL: z.string().min(1).optional(),
  /**
   * Worker connection. The worker archetype (`app_worker`) is the only role the
   * frozen schema grants the queue tables to, and its policies are deliberately
   * all-tenant — which is exactly why the web request path must NOT use it.
   * Separate DSN, separate role, separate process.
   */
  WORKER_DATABASE_URL: z.string().min(1).optional(),

  /** Bounded connection pool. A web instance must never exhaust the server. */
  DB_POOL_MAX: bounded(1, 50, 10),
  DB_POOL_IDLE_TIMEOUT_MS: bounded(1_000, 300_000, 30_000),
  DB_CONNECTION_TIMEOUT_MS: bounded(500, 60_000, 5_000),
  /** Server-side statement timeout. Explicit, because "no timeout" is a choice. */
  DB_STATEMENT_TIMEOUT_MS: bounded(100, 120_000, 15_000),

  /** Worker shape. Bounded batch and bounded concurrency are non-negotiable. */
  OUTBOX_BATCH_SIZE: bounded(1, 500, 25),
  OUTBOX_MAX_CONCURRENCY: bounded(1, 32, 4),
  OUTBOX_LEASE_SECONDS: bounded(5, 3_600, 300),
  OUTBOX_MAX_ATTEMPTS: bounded(1, 50, 8),
  OUTBOX_BASE_BACKOFF_MS: bounded(10, 600_000, 1_000),
  OUTBOX_MAX_BACKOFF_MS: bounded(1_000, 3_600_000, 300_000),
  OUTBOX_POLL_INTERVAL_MS: bounded(50, 600_000, 2_000),
  OUTBOX_SHUTDOWN_GRACE_MS: bounded(0, 120_000, 15_000),

  /** Identity of this worker process. Must satisfy the claimant format contract. */
  WORKER_ID: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{1,62}$/, 'must match ^[a-z][a-z0-9_.-]{1,62}$')
    .default('outbox_worker'),

  /**
   * Trusted reverse proxies, as a comma-separated list of exact remote addresses.
   * EMPTY BY DEFAULT: with no configured proxy, forwarded headers are ignored
   * entirely. That is the only safe default — trusting `X-Forwarded-For`
   * unconditionally lets any caller forge their own rate-limit identity.
   */
  TRUSTED_PROXY_IPS: z.string().default(''),

  /** Cache defaults. A TTL is always finite; "no TTL" is not expressible. */
  CACHE_DEFAULT_TTL_SECONDS: bounded(1, 86_400, 60),
  CACHE_MAX_ENTRIES: bounded(16, 100_000, 5_000),

  /** Rate-limit defaults. Proposed validation baselines, not approved targets. */
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type BackendConfig = Omit<z.infer<typeof schema>, 'TRUSTED_PROXY_IPS'> & {
  readonly TRUSTED_PROXY_IPS: readonly string[];
};

export class BackendConfigError extends Error {
  public override readonly name = 'BackendConfigError';
  constructor(detail: string) {
    super(
      `Invalid backend configuration.\n${detail}\n\n` +
        'Variable names only are shown; values are never echoed.'
    );
  }
}

let cached: BackendConfig | undefined;

/** Validated backend configuration. Server-only; refuses to run in a browser. */
export function backendConfig(): BackendConfig {
  if (typeof window !== 'undefined') {
    throw new Error('backendConfig() was called in the browser. It is server-only.');
  }
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new BackendConfigError(detail);
  }

  const { TRUSTED_PROXY_IPS, ...rest } = parsed.data;
  cached = {
    ...rest,
    TRUSTED_PROXY_IPS: TRUSTED_PROXY_IPS.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  };
  return cached;
}

/** Test seam: clears the memoised configuration. */
export function __resetBackendConfigForTests(): void {
  cached = undefined;
}
