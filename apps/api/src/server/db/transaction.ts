/**
 * Transaction wrapper and scoped session (P1-13-BE-003, P1-13-BE-011).
 *
 * This is the ONLY way the backend reaches PostgreSQL, and it enforces three
 * things that are easy to forget individually and fatal to forget together:
 *
 *  1. **Context before query.** `set_config('app.tenant_id' …, true)` runs before
 *     any caller statement, using the *transaction-local* form the database
 *     contract requires (P1-02-SEC-002). Transaction-local means the values
 *     evaporate at COMMIT/ROLLBACK, so a pooled connection can never leak one
 *     tenant's context into the next request — the single most dangerous failure
 *     mode in a pooled multi-tenant application.
 *  2. **No context, no handle.** A `DbHandle` cannot be constructed without a
 *     `RequestContext`, so "the repository forgot to set the tenant" is a
 *     compile error rather than a cross-tenant read.
 *  3. **All-or-nothing.** Business state, status history, audit append, and the
 *     outbox row share one transaction. Injected failure after the outbox write
 *     rolls back all four (BR-INT-001: an event exists if and only if its
 *     source transaction committed).
 *
 * Nesting uses SAVEPOINTs. A nested block that throws releases its savepoint and
 * rethrows, so an inner failure cannot silently commit an outer partial state.
 */
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { type RequestContext, contextLogFields } from '../context/request-context';
import { AppFailure } from '../errors/app-failure';
import { acquirePlatformClient, acquirePrimaryClient } from './pool';
import { backendConfig } from '../config/backend-config';
import { log } from '../observability/logger';

/**
 * A live transaction handle. Repositories accept this, never a raw client, so
 * there is no way to issue a query outside a scoped transaction.
 */
export interface DbHandle {
  /** The context this transaction is scoped to. Never mutable, never absent. */
  readonly context: RequestContext;
  /** Savepoint depth. 0 is the outermost transaction. */
  readonly depth: number;
  /**
   * Which pool the transaction runs on, and therefore which database role it
   * acts as. Absent on handles built outside `withTransaction`; treated as the
   * primary. Read by the capability preflight, which is per role.
   */
  readonly connection?: 'primary' | 'platform';
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<R>>;
}

export interface TransactionOptions {
  /**
   * Which connection to run on. `platform` selects the control-plane pool
   * (PRE-P1-29 Wave B, §6.8.3); anything else uses the primary. Defaulting to
   * the primary keeps every existing caller unchanged.
   */
  readonly connection?: 'primary' | 'platform';
  /**
   * Statement timeout for this transaction. Defaults to the configured value.
   * Long analytical work must opt in explicitly rather than inherit silently.
   */
  readonly statementTimeoutMs?: number;
  /**
   * `read only` starts a READ ONLY transaction — PostgreSQL then rejects any
   * write, which turns "this handler should not write" from a review comment
   * into an enforced property.
   */
  readonly access?: 'read write' | 'read only';
}

class TransactionHandle implements DbHandle {
  constructor(
    private readonly client: PoolClient,
    public readonly context: RequestContext,
    public readonly depth: number,
    /** Which pool the client came from. Read by withPlatformTarget, which refuses the primary. */
    public readonly connection: 'primary' | 'platform' = 'primary'
  ) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<R>> {
    /* c8 ignore next 3 -- structural guard for JavaScript callers; the type
       system already makes a context-less handle unconstructable. */
    if (!this.context) {
      throw new AppFailure('ERR-CTX-001', { message: 'Query attempted without a request context' });
    }
    return this.client.query<R>(text, values as unknown[]);
  }

  /** Derives a handle at the next savepoint depth on the same client. */
  nested(depth: number): TransactionHandle {
    return new TransactionHandle(this.client, this.context, depth, this.connection);
  }

  /** Derives a handle on the same client and depth whose context names another tenant. */
  retargeted(context: RequestContext): TransactionHandle {
    return new TransactionHandle(this.client, context, this.depth, this.connection);
  }
}

/**
 * Applies the transaction-scoped context contract.
 *
 * Values are bound as parameters — never interpolated — so a context value can
 * never become SQL. `set_config(..., true)` is the transaction-local form.
 */
async function applyContext(client: PoolClient, context: RequestContext): Promise<void> {
  const pairs: Array<[string, string]> = [
    ['app.tenant_id', context.principal.tenantId],
    ['app.user_id', context.principal.userId],
  ];
  // An empty list means "no narrowing", which the database expresses as an unset
  // (empty) value — see iam.allowed_company_ids(). Setting '' is equivalent to
  // unset there, and is set explicitly so the GUC is always defined.
  pairs.push(['app.company_ids', context.companyIds.join(',')]);
  pairs.push(['app.branch_ids', context.branchIds.join(',')]);

  for (const [key, value] of pairs) {
    await client.query('SELECT set_config($1, $2, true)', [key, value]);
  }
}

/**
 * Runs `fn` inside a transaction scoped to `context`.
 *
 * Commits on success, rolls back on any throw, and always releases the client.
 * The client is released with `release(true)` after a rollback failure so a
 * connection whose state is unknown is destroyed rather than returned to the
 * pool carrying an open transaction.
 */
export async function withTransaction<T>(
  context: RequestContext,
  fn: (db: DbHandle) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const config = backendConfig();
  const timeout = options.statementTimeoutMs ?? config.DB_STATEMENT_TIMEOUT_MS;
  const access = options.access ?? 'read write';

  // The control plane runs on its own connection, as `app_platform`. Every
  // platform policy is written TO that role, so serving a platform operation
  // from the primary pool would be refused by all of them while every
  // structural gate stayed green — the PC-1 shape.
  const client =
    options.connection === 'platform'
      ? await acquirePlatformClient()
      : await acquirePrimaryClient();
  let rolledBackCleanly = true;
  try {
    await client.query(`BEGIN ${access === 'read only' ? 'READ ONLY' : 'READ WRITE'}`);
    // `set_config(..., true)` rather than `SET LOCAL`: SET is a utility statement
    // and cannot take a bind parameter (`SET LOCAL statement_timeout = $1` is a
    // syntax error, verified against PostgreSQL 17). The function form is
    // parameterisable — so the value is bound rather than interpolated, leaving
    // no injection surface at all — and `is_local = true` gives the same
    // transaction-scoped reversion, which is what stops a timeout leaking to the
    // next user of this pooled connection.
    await client.query('SELECT set_config($1, $2, true)', [
      'statement_timeout',
      String(Math.trunc(timeout)),
    ]);
    await applyContext(client, context);

    const handle = new TransactionHandle(
      client,
      context,
      0,
      options.connection === 'platform' ? 'platform' : 'primary'
    );
    const result = await fn(handle);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      rolledBackCleanly = false;
      log.error('Rollback failed; destroying the connection', {
        ...contextLogFields(context),
        result: 'failure',
        context: { rollback: rollbackError instanceof Error ? rollbackError.name : 'unknown' },
      });
    }
    throw error;
  } finally {
    client.release(rolledBackCleanly ? undefined : true);
  }
}

/**
 * A handle scoped to a tenant the acting principal does not belong to — the
 * platform-on-target context of the control-plane design (PRE-P1-29 Wave B
 * §6.3, P1-29 W9). Only `withPlatformTarget` constructs one.
 */
export interface PlatformTargetHandle extends DbHandle {
  /** The tenant every write inside the window is bound to. */
  readonly targetTenantId: string;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` with the transaction's tenant context moved to `targetTenantId`
 * for exactly its duration, then moves it back — the platform-on-target
 * context the First-Owner bootstrap needs (§6.3): the operator's session
 * resolves to their HOME tenant, but the rows the bootstrap writes belong to
 * the tenant the same transaction has just created, and every §6.3 policy
 * binds the written row to `iam.current_tenant_id()`.
 *
 * Three refusals keep this narrow rather than general:
 *
 *  - Only a control-plane transaction may retarget. The primary connection
 *    runs as `app_runtime`, whose policies are written against the session's
 *    own tenant; retargeting it would be a cross-tenant write path, so the
 *    call throws before touching the session.
 *  - The target must be a tenant this very transaction created and that is
 *    still `provisioning`: `created_at = now()` holds only for rows written
 *    by the current transaction (now() is the transaction start), and
 *    `created_by` must be the acting principal. A caller cannot aim the
 *    window at a tenant that merely happens to be provisioning.
 *  - The context handed to `fn` is a copy whose principal names the target
 *    tenant, so repositories that stamp `tenant_id` from the context write
 *    the target — and the actor (`userId`) is unchanged, so attribution still
 *    names the operator. Nothing from the request participates.
 *
 * The GUC is restored in `finally`. After a failed statement the transaction
 * is aborted and the restore itself fails; that failure is swallowed so the
 * ORIGINAL error propagates — the whole transaction rolls back anyway, which
 * is what discards the half-written bootstrap.
 */
export async function withPlatformTarget<T>(
  db: DbHandle,
  targetTenantId: string,
  fn: (target: PlatformTargetHandle) => Promise<T>
): Promise<T> {
  const handle = db as TransactionHandle;
  if (handle.connection !== 'platform') {
    throw new AppFailure('ERR-CTX-001', {
      message: 'A platform-on-target context is only available on the control-plane connection',
    });
  }
  if (!UUID_SHAPE.test(targetTenantId)) {
    throw new AppFailure('ERR-VAL-001', { message: 'The target tenant is not a well-formed id' });
  }
  const created = await db.query<{ id: string }>(
    `SELECT id
       FROM org.tenants
      WHERE id = $1
        AND status = 'provisioning'
        AND created_by = $2
        AND created_at = now()`,
    [targetTenantId, db.context.principal.userId]
  );
  if (created.rows.length !== 1) {
    throw new AppFailure('ERR-CTX-001', {
      message: 'The target tenant was not created by this transaction or is no longer provisioning',
    });
  }
  const homeTenantId = db.context.principal.tenantId;
  const retargeted = handle.retargeted({
    ...db.context,
    principal: { ...db.context.principal, tenantId: targetTenantId },
  });
  const target: PlatformTargetHandle = Object.assign(retargeted, { targetTenantId });
  await db.query('SELECT set_config($1, $2, true)', ['app.tenant_id', targetTenantId]);
  try {
    return await fn(target);
  } finally {
    try {
      await db.query('SELECT set_config($1, $2, true)', ['app.tenant_id', homeTenantId]);
    } catch {
      // The transaction is already aborted; the rollback discards the window.
    }
  }
}

/**
 * Runs `fn` inside a SAVEPOINT on an existing transaction.
 *
 * Use where a sub-step may fail without discarding the whole command. The outer
 * transaction's atomicity is preserved: a failure here rolls back only to the
 * savepoint, and rethrows so the caller decides.
 */
export async function withSavepoint<T>(
  db: DbHandle,
  fn: (nested: DbHandle) => Promise<T>
): Promise<T> {
  const handle = db as TransactionHandle;
  const depth = db.depth + 1;
  // Identifier, not a value — built from a bounded integer, never from input.
  const name = `sp_${depth}`;

  await db.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn(handle.nested(depth));
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

/**
 * Read-only convenience: a transaction PostgreSQL will refuse to let write.
 * Query handlers should prefer this so a stray INSERT fails in tests, not later.
 */
export async function withReadOnlyTransaction<T>(
  context: RequestContext,
  fn: (db: DbHandle) => Promise<T>,
  options: Omit<TransactionOptions, 'access'> = {}
): Promise<T> {
  return withTransaction(context, fn, { ...options, access: 'read only' });
}
