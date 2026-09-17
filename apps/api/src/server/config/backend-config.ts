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
 *  3. **A setting is not operational because this file accepts it.** Validation
 *     proves a value is well-formed, never that anything reads it. The names in
 *     `RESERVED_SETTINGS` below are accepted and read by NOTHING: setting one
 *     has no effect. They stay in the schema so a deployment that already sets
 *     them still starts, they are absent from `REQUIRED_WHEN_DEPLOYED` because
 *     refusing readiness over an inert value would be a false gate, and
 *     `tests/foundation/reserved-settings.test.ts` derives the accepted names
 *     from this schema and fails if one of them is neither consumed nor listed.
 *
 * Read-replica routing is the oldest example: `DATABASE_REPLICA_URL` is accepted
 * so deployment topology can be expressed, while `poolFor('replica')` returns
 * the primary pool and records why. No replica is provisioned (ADR-012) and none
 * is claimed.
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
  /**
   * RESERVED — accepted, validated, and read by nothing. Setting it has no
   * effect: no replica is provisioned (ADR-012) and no routing code exists.
   * Listed in `RESERVED_SETTINGS` below.
   */
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

  /**
   * RESERVED — accepted, validated, and read by nothing. Setting it has no
   * effect. `Cache.set()` requires an explicit `ttlSeconds` from its caller and
   * there is no code path that falls back to a default, so there is nothing for
   * a value here to govern. Listed in `RESERVED_SETTINGS` below, which a test
   * checks against the real consumers.
   */
  CACHE_DEFAULT_TTL_SECONDS: bounded(1, 86_400, 60),
  /** In-process cache ceiling. Read by `server/cache/cache.ts`. */
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
   * RESERVED — accepted, validated, and read by nothing. Setting it has no
   * effect and no `Access-Control-Allow-Origin` header is emitted for it.
   *
   * There is no CORS layer, and no response-header layer of any kind, on this
   * tier: `server/http/route-handler.ts` is the only edge and it writes no
   * cross-origin header. A value here would have nothing to obey. It stays in
   * the schema so an existing deployment that sets it still starts, and it is
   * listed in `RESERVED_SETTINGS` below so the omission cannot be mistaken for
   * an oversight. It is deliberately NOT in `REQUIRED_WHEN_DEPLOYED`: refusing
   * to become ready over a value that changes nothing would be a false gate.
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

/**
 * Every name this schema accepts, derived from the schema and not from a list
 * maintained beside it.
 *
 * `Object.keys(schema.shape)` is the schema's own answer, so a name added above
 * appears here in the same commit and cannot be forgotten. The guard test reads
 * this rather than re-parsing the file, which is what makes it a check on the
 * contract instead of a check on a regex.
 */
export const ACCEPTED_SETTING_NAMES: readonly string[] = Object.freeze(
  Object.keys(schema.shape).sort()
);

/**
 * Accepted, validated, and read by NOTHING outside this module.
 *
 * Each entry is a name whose value has no effect at runtime, with the reason it
 * has none. This list exists because "the validator accepts it" had been reading
 * as "the deployment can rely on it", and a settings surface that quietly does
 * nothing is worse than one that is honestly smaller.
 *
 * The three rules that make an entry here honest, all enforced by
 * `tests/foundation/reserved-settings.test.ts`:
 *
 *  1. the name is still ACCEPTED — an existing deployment that sets it starts
 *     exactly as before, and removing it from the schema would be the breaking
 *     change this deliberately is not;
 *  2. the name is NOT in `REQUIRED_WHEN_DEPLOYED` and cannot fail readiness,
 *     because a missing value that governs nothing must not stop a deployment;
 *  3. the name has NO consumer — an entry that gains one has to leave this list
 *     in the same change, and the test fails while it has not.
 */
export const RESERVED_SETTINGS: Readonly<Record<string, string>> = Object.freeze({
  CACHE_DEFAULT_TTL_SECONDS:
    'Cache.set() requires an explicit ttlSeconds from its caller and no path ' +
    'falls back to a default, so there is nothing for this value to govern.',
  CORS_ALLOWED_ORIGINS:
    'No CORS layer and no response-header layer exists on this tier, so no ' +
    'Access-Control-Allow-Origin header is emitted for any value set here.',
  DATABASE_REPLICA_URL:
    'Read-replica routing is not implemented — poolFor("replica") returns the ' +
    'primary pool — and no replica is provisioned (ADR-012).',
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

/**
 * The raw environment, as this module inspects it before zod coerces anything.
 *
 * Deliberately a plain record rather than `BackendConfig`: the production
 * requirements below are about ABSENCE, and the parsed shape has already
 * substituted defaults for several of the names in question. `''` and
 * `undefined` become indistinguishable once `CORS_ALLOWED_ORIGINS` is `[]`.
 */
export type RawEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Environments in which the values below stop being optional.
 *
 * `local` and `development` are excluded on purpose: the whole test tier, the
 * launcher and a fresh clone run without a database, without an identity
 * provider and without an object store, and that has to keep working.
 */
const PRODUCTION_LIKE = new Set(['staging', 'production']);

/**
 * Names that must carry a non-empty value once the deployment is not local.
 *
 * **Membership here is a claim that something reads the value.** Every name
 * below has a consumer cited beside it; a name whose only relationship to the
 * code is that the schema parses it belongs in `RESERVED_SETTINGS` instead, and
 * the guard test refuses any overlap between the two.
 */
export const REQUIRED_WHEN_DEPLOYED: readonly string[] = [
  /** The request-path pool. `pool.ts` throws `DatabaseNotConfiguredError` without it. */
  'DATABASE_URL',
  /** The control plane. It has NO fallback to `DATABASE_URL` and fails closed. */
  'PLATFORM_DATABASE_URL',
  /** Read through `serverEnv()`; the iam adapter refuses to compose without it. */
  'SUPABASE_SERVICE_ROLE_KEY',
  /** Token verification. Absent means no request can ever authenticate. */
  'AUTH_JWT_SECRET',
  'AUTH_JWT_ISSUER',
  /**
   * Empty is the safe default locally — it rejects every caller-supplied
   * redirect — but a deployment that serves password-reset and invitation links
   * and names no destination cannot complete either flow.
   */
  'AUTH_REDIRECT_ALLOWLIST',
  // `CORS_ALLOWED_ORIGINS` was required here and is deliberately not any more:
  // nothing reads it, so a deployment that omitted it was refused readiness over
  // a value that would have changed nothing. It is in `RESERVED_SETTINGS`.
];

/** Storage selections that cannot serve a deployed request. */
const NON_SERVING_STORAGE = new Set(['', 'unconfigured', 'local_fake']);

/** Credentials the adapter itself demands once `s3_compatible` is selected. */
const S3_REQUIRED = [
  'STORAGE_S3_ENDPOINT',
  'STORAGE_S3_ACCESS_KEY_ID',
  'STORAGE_S3_SECRET_ACCESS_KEY',
] as const;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * The names a staging or production deployment is missing. **Names only.**
 *
 * Pure: it reads the record it is handed and nothing else, so readiness, a test
 * and any future preflight can ask the same question of different inputs. It
 * returns an empty list for every environment that is not `staging` or
 * `production`, which is why wiring it into readiness cannot change local or
 * test behaviour.
 *
 * No value is inspected beyond "is it present" and, for the storage selection,
 * "is it one of the explicitly non-serving choices" — so nothing that reaches
 * the returned list can be a credential.
 */
export function productionConfigurationProblems(env: RawEnvironment): string[] {
  if (!PRODUCTION_LIKE.has(env['NEXT_PUBLIC_APP_ENV'] ?? '')) return [];

  const problems: string[] = [];
  for (const name of REQUIRED_WHEN_DEPLOYED) {
    if (isBlank(env[name])) problems.push(name);
  }

  // Attachments are not feature-gated: `UnconfiguredStorageProvider` refuses at
  // the first signed-URL request, and `local_fake` signs against a `.invalid`
  // host. Either one, deployed, is an outage of the whole attachment surface.
  const storage = (env['STORAGE_PROVIDER'] ?? '').trim();
  if (NON_SERVING_STORAGE.has(storage)) {
    problems.push('STORAGE_PROVIDER');
  } else if (storage === 's3_compatible') {
    for (const name of S3_REQUIRED) {
      if (isBlank(env[name])) problems.push(name);
    }
  }

  // Disabling the limiter is expressible, and locally it is sometimes useful.
  // Deployed it removes the only protection the public routes have.
  if ((env['RATE_LIMIT_ENABLED'] ?? 'true').trim() === 'false') {
    problems.push('RATE_LIMIT_ENABLED');
  }

  return problems;
}
