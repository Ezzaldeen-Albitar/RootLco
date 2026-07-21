/**
 * Bounded connection pools (P1-13-BE-003, scalability readiness).
 *
 * One pool per *consistency role*, not one pool per caller:
 *
 *  - `primary` — every write, and every read that participates in a decision
 *    (authorization, entitlement, idempotency, command validation, read-after-write).
 *  - `replica` — reserved. `DATABASE_REPLICA_URL` may be configured so deployment
 *    topology is expressible, but `poolFor('replica')` currently returns the
 *    primary pool and records why. No replica is provisioned (ADR-012), replica
 *    lag is not observable yet, and silently routing a strongly-consistent read
 *    to a lagging replica is the single most damaging thing this layer could do.
 *
 * The pool is created lazily and cached per process, because a module-scope pool
 * would open sockets during a build and in every worker thread that imports this
 * file.
 */
import { Pool, type PoolClient } from 'pg';
import { backendConfig } from '../config/backend-config';
import { log } from '../observability/logger';

/** Which consistency guarantee the caller needs. */
export type ConsistencyRole = 'primary' | 'replica';

let primary: Pool | undefined;
let replicaWarningEmitted = false;

function createPool(connectionString: string): Pool {
  const config = backendConfig();
  const pool = new Pool({
    connectionString,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    // Applied per connection, so a runaway query cannot pin a pooled client
    // indefinitely. Transactions may tighten it further with SET LOCAL.
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    application_name: 'rootlco-backend',
  });

  // An idle-client error (server restart, network reset) is emitted on the pool.
  // Without a listener it becomes an unhandled 'error' event and kills the process.
  pool.on('error', (error) => {
    log.error('Idle database client error', {
      module: 'db',
      operation: 'pool.idle-error',
      result: 'failure',
      context: { name: error.name },
    });
  });

  return pool;
}

export class DatabaseNotConfiguredError extends Error {
  public override readonly name = 'DatabaseNotConfiguredError';
  constructor() {
    super(
      'DATABASE_URL is not configured. The backend foundation requires a PostgreSQL ' +
        'connection whose login role is a member of app_runtime (never an owner, ' +
        'never BYPASSRLS).'
    );
  }
}

/** The primary pool. Throws rather than guessing a connection string. */
export function primaryPool(): Pool {
  if (!primary) {
    const { DATABASE_URL } = backendConfig();
    if (!DATABASE_URL) throw new DatabaseNotConfiguredError();
    primary = createPool(DATABASE_URL);
  }
  return primary;
}

/**
 * Resolves a pool for the requested consistency role.
 *
 * `replica` intentionally returns the primary. Activating replica routing
 * requires: a provisioned replica, observable replication lag, and an approved
 * list of stale-tolerant operations. Until all three exist, routing here would
 * be a correctness claim with no evidence behind it.
 */
export function poolFor(role: ConsistencyRole): Pool {
  if (role === 'replica' && !replicaWarningEmitted) {
    replicaWarningEmitted = true;
    log.info('Replica routing requested; serving from primary (no replica activated)', {
      module: 'db',
      operation: 'pool.replica-fallback',
      result: 'skipped',
    });
  }
  return primaryPool();
}

/** Acquires a client from the primary pool. Callers must always release it. */
export async function acquirePrimaryClient(): Promise<PoolClient> {
  return primaryPool().connect();
}

/** Closes pools. Called by graceful shutdown and by test teardown. */
export async function closePools(): Promise<void> {
  const existing = primary;
  primary = undefined;
  replicaWarningEmitted = false;
  if (existing) await existing.end();
}

/** Test seam: installs a pre-built pool (e.g. one bound to a test login role). */
export function __setPrimaryPoolForTests(pool: Pool | undefined): void {
  primary = pool;
}
