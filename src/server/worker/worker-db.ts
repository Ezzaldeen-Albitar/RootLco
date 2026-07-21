/**
 * Worker database access (P1-13-BE-016).
 *
 * The worker is a *different archetype* from the web path, and this file is
 * where that separation is made real rather than described:
 *
 *  - it connects with `WORKER_DATABASE_URL`, whose login role is a member of
 *    `app_worker` — the only archetype the frozen schema grants the queue tables
 *    (`shared.event_outbox`, `shared.processed_events`, `shared.error_records`);
 *  - `app_worker` policies are `USING (true)` — deliberately all-tenant, because
 *    a dispatcher must see every tenant's queue. That is precisely why the
 *    request path must never borrow this connection: it would dissolve tenant
 *    isolation for user-facing reads;
 *  - there is therefore **no `RequestContext`** here. Worker transactions carry
 *    no `app.tenant_id`, and the tenant of each event is read from the row.
 *
 * A separate pool, a separate role, and a separate process role (`web` vs
 * `worker`) is also what makes the two independently scalable.
 */
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { backendConfig } from '../config/backend-config';
import { log } from '../observability/logger';

/**
 * System actor recorded in `created_by` for worker-written rows. These columns
 * carry no foreign key to `iam.user_accounts` (verified against the frozen
 * schema), so a stable synthetic actor is representable and honest: the row was
 * written by the platform, not by a person.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

/** Minimal query surface. No context, by design. */
export interface WorkerDb {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<R>>;
}

let workerPool: Pool | undefined;

export class WorkerNotConfiguredError extends Error {
  public override readonly name = 'WorkerNotConfiguredError';
  constructor() {
    super(
      'WORKER_DATABASE_URL (or DATABASE_URL) must be configured, and its login role must be a ' +
        'member of app_worker.'
    );
  }
}

export function workerDbPool(): Pool {
  if (!workerPool) {
    const config = backendConfig();
    const dsn = config.WORKER_DATABASE_URL ?? config.DATABASE_URL;
    if (!dsn) throw new WorkerNotConfiguredError();
    workerPool = new Pool({
      connectionString: dsn,
      // A worker's pool is sized by its own concurrency, not the web tier's.
      max: Math.max(2, config.OUTBOX_MAX_CONCURRENCY + 1),
      idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
      statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
      application_name: 'rootlco-outbox-worker',
    });
    workerPool.on('error', (error) => {
      log.error('Idle worker database client error', {
        module: 'outbox-worker',
        operation: 'pool.idle-error',
        result: 'failure',
        context: { name: error.name },
      });
    });
  }
  return workerPool;
}

/** Runs `fn` in a worker transaction. No `app.*` context is set. */
export async function withWorkerTransaction<T>(fn: (db: WorkerDb) => Promise<T>): Promise<T> {
  const client: PoolClient = await workerDbPool().connect();
  let clean = true;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      clean = false;
    }
    throw error;
  } finally {
    client.release(clean ? undefined : true);
  }
}

/** Single statement outside a transaction, for claim/complete/fail calls. */
export async function workerQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
): Promise<QueryResult<R>> {
  return workerDbPool().query<R>(text, values as unknown[]);
}

export async function closeWorkerPool(): Promise<void> {
  const existing = workerPool;
  workerPool = undefined;
  if (existing) await existing.end();
}

export function __setWorkerPoolForTests(pool: Pool | undefined): void {
  workerPool = pool;
}
