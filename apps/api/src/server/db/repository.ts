/**
 * Controlled data-access layer (P1-13-BE-003).
 *
 * A repository is the only place SQL is written, and it may only run through a
 * `DbHandle` — which cannot exist without a resolved `RequestContext`. That is
 * the structural half of the control.
 *
 * The behavioural half is here: `assertContext()` fails closed **before** the
 * statement reaches the database, with `ERR-CTX-001`. Relying on RLS alone to
 * catch a missing context would work (default deny returns zero rows) but it
 * would be silent — an empty result set looks like "no data", not like "the
 * application forgot who was asking". Loud beats subtle.
 *
 * Query-shape rules enforced by convention and asserted in tests:
 *   - every tenant-owned query carries an explicit tenant predicate, in addition
 *     to RLS. Defence in depth: RLS is the guarantee, the predicate is the intent;
 *   - values are always bound parameters, never interpolated;
 *   - list queries are always bounded and deterministically ordered
 *     (see `pagination.ts`).
 */
import type { QueryResult, QueryResultRow } from 'pg';
import { AppFailure } from '../errors/app-failure';
import type { DbHandle } from './transaction';
import type { RequestContext } from '../context/request-context';

/** Base class for every repository. Owns the guard, not the SQL. */
export abstract class Repository {
  /** Owning module, used in errors and logs. */
  protected abstract readonly module: string;

  /**
   * Refuses to proceed without a usable context. Checks the *shape*, not just
   * presence: a handle carrying a context with an empty tenant is as dangerous
   * as no context at all.
   */
  protected assertContext(db: DbHandle): RequestContext {
    const context = db?.context;
    if (!context || !context.principal?.tenantId || !context.principal?.userId) {
      throw new AppFailure('ERR-CTX-001', {
        message: `${this.module}: repository call without a resolved request context`,
      });
    }
    return context;
  }

  /** Runs a parameterised statement after the context guard. */
  protected async run<R extends QueryResultRow = QueryResultRow>(
    db: DbHandle,
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<R>> {
    this.assertContext(db);
    return db.query<R>(text, values);
  }

  /** Runs a statement expected to return at most one row. */
  protected async runOne<R extends QueryResultRow = QueryResultRow>(
    db: DbHandle,
    text: string,
    values: readonly unknown[] = []
  ): Promise<R | null> {
    const result = await this.run<R>(db, text, values);
    return result.rows[0] ?? null;
  }
}

/**
 * PostgreSQL SQLSTATEs the foundation reacts to by name rather than by message.
 * Driver messages are not a stable contract; SQLSTATEs are.
 */
export const SQLSTATE = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  invalidParameterValue: '22023',
  /**
   * An `EXCLUDE` constraint refused the row.
   *
   * Distinct from `uniqueViolation` and worth its own name: the schema uses gist
   * EXCLUDE for temporal invariants an ordinary unique index cannot express — one
   * active labour session per technician (`ex_labor_sessions_overlap`), one active
   * plate per vehicle, non-overlapping availability — and those all arrive here.
   */
  exclusionViolation: '23P01',
  insufficientPrivilege: '42501',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
  lockNotAvailable: '55P03',
  queryCanceled: '57014',
} as const;

/** Reads the SQLSTATE from an unknown driver error, if present. */
export function sqlState(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** True when the error is the named SQLSTATE. */
export function isSqlState(
  error: unknown,
  state: (typeof SQLSTATE)[keyof typeof SQLSTATE]
): boolean {
  return sqlState(error) === state;
}

/**
 * Reads the violated constraint name from an unknown driver error, if present.
 *
 * A SQLSTATE says WHICH KIND of rule was broken and a table usually has several of
 * the same kind, so a mapping keyed on the state alone answers for constraints it
 * was never written for. `violatedConstraint` is what lets a handler map exactly
 * the one it means and re-throw the rest. It lives beside `sqlState` because two
 * modules now need it and a copy in each is how two readings of the same driver
 * error start to disagree; the name is the driver's `constraint` field, which
 * PostgreSQL populates for the integrity-violation classes.
 */
export function violatedConstraint(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'constraint' in error) {
    const name = (error as { constraint?: unknown }).constraint;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/**
 * Translates a foreign-key refusal into a refusal of the ONE request field that
 * carried the reference, or answers `undefined` so the caller re-throws.
 *
 * A reference column (a currency, a language, a time zone) is checked by its
 * foreign key, and before this helper the violation reached the caller as
 * `500 ERR-SYS-001`: the input was wrong, and the answer said the server was.
 * The map is keyed on the constraint NAME, never on the SQLSTATE alone, because
 * one table carries several foreign keys and a state-only mapping would label a
 * tenant or company key as a bad currency. A constraint the map does not name is
 * left to the caller, which re-throws it to the unchanged 500 path.
 *
 * Nothing from the driver is copied — not `detail`, which carries the submitted
 * value (`Key (base_currency_code)=(JOR)`), and not `message`. The refusal says
 * which field and which rule, and nothing else.
 */
export function referenceRefusal(
  error: unknown,
  pointerByConstraint: Readonly<Record<string, string>>,
  rule = 'unknown_reference'
): AppFailure | undefined {
  if (!isSqlState(error, SQLSTATE.foreignKeyViolation)) return undefined;
  const constraint = violatedConstraint(error);
  if (constraint === undefined || !Object.prototype.hasOwnProperty.call(pointerByConstraint, constraint)) {
    return undefined;
  }
  const path = pointerByConstraint[constraint];
  if (path === undefined) return undefined;
  return new AppFailure('ERR-VAL-001', {
    message: `The value at ${path} does not name a registered platform reference`,
    safeDetails: { violations: [{ path, rule }] },
  });
}
