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

  /**
   * The control-plane connection (PRE-P1-29 Wave B, §6.8.3).
   *
   * Its login role holds membership of `app_platform` AND of no other
   * application archetype. That exclusivity is the containment: PostgreSQL
   * enforces membership at the login role, so a role holding both `app_platform`
   * and `app_runtime` would carry both authorities by inheritance on one
   * connection, and the `SET ROLE` prohibition would buy nothing.
   *
   * Deliberately does NOT follow `WORKER_DATABASE_URL`'s `?? DATABASE_URL`
   * fallback. Falling back would put platform authority on the request path's
   * role — the exact state §6.8.3 exists to forbid — and it would do so
   * silently. Absent, the platform path fails closed instead.
   */
  PLATFORM_DATABASE_URL: z.string().min(1).optional(),

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

  // ---- Authentication (P1-14, ADR-019) ------------------------------------
  //
  // Every value below is server-only and is never echoed. The provider itself is
  // reached through the `IdentityProvider` port; these settings describe what a
  // token must satisfy before the request is allowed to continue.

  /**
   * Value written to and matched against `iam.user_accounts.identity_provider`.
   * Constrained to the column's own format so a misconfiguration fails here
   * rather than as a CHECK violation on the first invitation.
   */
  AUTH_IDENTITY_PROVIDER: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$')
    .default('supabase'),

  /** Expected `iss`. A token minted by another issuer is rejected outright. */
  AUTH_JWT_ISSUER: z.string().min(1).optional(),
  /** Expected `aud`. GoTrue issues `authenticated` for a signed-in user. */
  AUTH_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
  /**
   * Accepted signing algorithms, comma-separated.
   *
   * An allow-list rather than "whatever the header says" is the control that
   * stops the `alg: none` and the RS256→HS256 confusion attacks: the verifier
   * decides the algorithm, the token does not.
   */
  AUTH_JWT_ALGORITHMS: z.string().default('HS256'),
  /** Shared secret for HS* verification. Absent means the app cannot authenticate. */
  AUTH_JWT_SECRET: z.string().min(1).optional(),
  /**
   * Tolerance for clock drift between the provider and this process, in seconds.
   * Bounded: an unbounded skew turns `exp` into a suggestion.
   */
  AUTH_CLOCK_SKEW_SECONDS: bounded(0, 300, 60),

  /** Server-enforced idle timeout. Measured from the session's last activity. */
  SESSION_IDLE_TIMEOUT_MINUTES: bounded(1, 1_440, 30),
  /**
   * How stale `last_seen_at` may get before a request refreshes it. Refreshing
   * on every request would mean a write per read; refreshing never would make
   * the idle timeout fire on active sessions. This is the throttle between them.
   */
  SESSION_ACTIVITY_REFRESH_SECONDS: bounded(5, 3_600, 60),

  /**
   * Exact, absolute redirect destinations permitted for password-reset and
   * invitation links, comma-separated.
   *
   * EMPTY BY DEFAULT, and an empty list rejects every caller-supplied redirect.
   * That is the only safe default: forwarding an arbitrary `redirectTo` to the
   * provider is an open redirect that arrives carrying a single-use token.
   */
  AUTH_REDIRECT_ALLOWLIST: z.string().default(''),

  /**
   * Exact origins permitted by CORS, comma-separated. Empty means same-origin
   * only, which is the deployed shape today: no separate frontend origin exists.
   */
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  /** Consecutive failed logins before the account is locked. */
  LOGIN_MAX_FAILED_ATTEMPTS: bounded(1, 100, 5),
  /** Window over which consecutive failures are counted, in minutes. */
  LOGIN_FAILURE_WINDOW_MINUTES: bounded(1, 1_440, 15),

  // ---- Shared services (P1-15) --------------------------------------------
  //
  // Object storage and message delivery are reached through ports. **No
  // production provider is provisioned for either** (ADR-012 remains open), and
  // the default below says so rather than quietly selecting one: `unconfigured`
  // refuses to sign a URL or contact a provider at all. A deterministic local
  // adapter exists for development and tests and is selected explicitly.

  /**
   * Environment token that forms the first segment of every storage key
   * (`docs/database/storage-key-convention.md` §3).
   *
   * Read from the same variable the client reads so one deployment cannot
   * disagree with itself about which environment it is. It is duplicated here
   * rather than imported because `storage_key` is immutable once written: a key
   * minted under the wrong token can never be corrected, only superseded by a
   * new version, so the value must be validated on the server path too.
   */
  NEXT_PUBLIC_APP_ENV: z.enum(['local', 'development', 'staging', 'production']).default('local'),

  /**
   * Object-storage adapter. `unconfigured` (default) refuses every call;
   * `local_fake` is the deterministic in-process adapter used by tests and
   * development, which reaches no network and issues no usable URL.
   */
  STORAGE_PROVIDER: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$')
    .default('unconfigured'),
  /** S3-compatible endpoint and server-only credentials (Supabase local/hosted supported). */
  STORAGE_S3_ENDPOINT: z.string().url().optional(),
  STORAGE_S3_REGION: z.string().min(1).default('local'),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Bucket/container name. Never a path, never caller-supplied. */
  STORAGE_BUCKET: z.string().min(1).default('rootlco-attachments'),
  /**
   * Signed-URL lifetimes. Bounded on BOTH sides: a URL that lives for hours is a
   * bearer credential in a browser history, and one that lives for two seconds
   * cannot survive a slow upload. Upload gets the longer window because the
   * transfer itself happens inside it.
   */
  STORAGE_UPLOAD_URL_TTL_SECONDS: bounded(30, 900, 600),
  STORAGE_DOWNLOAD_URL_TTL_SECONDS: bounded(15, 600, 120),
  /**
   * Platform ceiling on a single object, in bytes. This is a *ceiling*, not the
   * limit: `shared.document_categories.max_size_bytes` is authoritative per
   * category and is always enforced as well. 25 MiB by default.
   */
  STORAGE_MAX_UPLOAD_BYTES: bounded(1_024, 268_435_456, 26_214_400),

  /**
   * Message-delivery adapter. `unconfigured` (default) refuses to deliver;
   * enqueueing still works, because the outbound row is the durable record and
   * delivery is the worker's separate concern.
   */
  NOTIFICATION_PROVIDER: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$')
    .default('unconfigured'),
  /** Per-attempt provider timeout. A hung provider must not hold a worker slot. */
  NOTIFICATION_PROVIDER_TIMEOUT_MS: bounded(100, 60_000, 5_000),
  /** Rendered message ceiling, in characters, across every channel. */
  NOTIFICATION_MAX_RENDERED_CHARS: bounded(256, 262_144, 20_000),

  /**
   * Budget for the whole readiness probe. A probe that can block indefinitely
   * turns a slow dependency into an outage of the orchestrator's health check.
   */
  READINESS_TIMEOUT_MS: bounded(50, 10_000, 2_000),

  /** Largest row estimate an export authorization will approve synchronously. */
  EXPORT_MAX_ROWS: bounded(1, 1_000_000, 50_000),
});

/** Splits a comma-separated setting into trimmed, non-empty entries. */
function commaList(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

type RawBackendConfig = z.infer<typeof schema>;

export type BackendConfig = Omit<
  RawBackendConfig,
  'TRUSTED_PROXY_IPS' | 'AUTH_JWT_ALGORITHMS' | 'AUTH_REDIRECT_ALLOWLIST' | 'CORS_ALLOWED_ORIGINS'
> & {
  readonly TRUSTED_PROXY_IPS: readonly string[];
  readonly AUTH_JWT_ALGORITHMS: readonly string[];
  readonly AUTH_REDIRECT_ALLOWLIST: readonly string[];
  readonly CORS_ALLOWED_ORIGINS: readonly string[];
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

  const {
    TRUSTED_PROXY_IPS,
    AUTH_JWT_ALGORITHMS,
    AUTH_REDIRECT_ALLOWLIST,
    CORS_ALLOWED_ORIGINS,
    ...rest
  } = parsed.data;
  cached = {
    ...rest,
    TRUSTED_PROXY_IPS: commaList(TRUSTED_PROXY_IPS),
    AUTH_JWT_ALGORITHMS: commaList(AUTH_JWT_ALGORITHMS),
    AUTH_REDIRECT_ALLOWLIST: commaList(AUTH_REDIRECT_ALLOWLIST),
    CORS_ALLOWED_ORIGINS: commaList(CORS_ALLOWED_ORIGINS),
  };
  return cached;
}

/** Test seam: clears the memoised configuration. */
export function __resetBackendConfigForTests(): void {
  cached = undefined;
}
