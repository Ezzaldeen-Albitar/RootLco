/**
 * Bounded filtering, sorting, and cursor binding (P1-15).
 *
 * Every list endpoint eventually grows a filter parameter, and the shortest path
 * from there to an incident is `WHERE ${field} ${operator} '${value}'`. This
 * module makes that shape unavailable: an operation declares a **contract** —
 * which fields may be filtered, with which operators, and which may be sorted —
 * and the builder emits SQL only from that contract.
 *
 *  - **Field names never reach SQL.** The contract maps a caller-visible name to
 *    a column *constant written in code*. An unrecognised name is rejected; it is
 *    never interpolated, not even to be quoted.
 *  - **Operators are per field.** `prefix` on a UUID column is refused, so a
 *    caller cannot turn an indexed equality into a scan.
 *  - **Values are always bound parameters** and always type-checked against the
 *    field's declared type first.
 *  - **Everything is bounded**: filter count, `in` list length, string length.
 *    An unbounded `in` list is a denial-of-service with extra steps.
 *  - **There is no regex operator, and no raw JSON path.** Neither can be made
 *    safe against catastrophic backtracking or against reading a column the
 *    contract did not offer, so neither exists.
 *
 * ## The cursor is bound to the query, and is still not a security boundary
 *
 * `src/server/db/pagination.ts` states plainly that the cursor is unsigned
 * base64url JSON. That does not change here: what changes is that the cursor's
 * contract key now carries a **fingerprint of the filter set, the sort, and the
 * tenant**, so a cursor issued for one query fails closed in another instead of
 * silently producing a wrong page.
 *
 * A fingerprint is not a signature and is not claimed to be one. Tampering is
 * *detected* only in the sense that a modified cursor stops matching; a caller
 * who recomputes the fingerprint can forge one. That is acceptable precisely
 * because the cursor decides nothing about authorization: every page still runs
 * under RLS and the caller's own context, so the worst a forged cursor achieves
 * is a page of the caller's own rows starting somewhere else. Signing the cursor
 * would need a shared key across instances, and no key management is
 * provisioned — recorded as an open decision rather than half-built.
 */
import { createHash } from 'node:crypto';
import { AppFailure } from '@/server/errors/app-failure';

/**
 * Structural mirror of `OrderingContract` from `@/server/db/pagination`.
 *
 * Declared here rather than imported because boundary rule **B5** forbids a
 * module's `domain` layer from importing `server/db` — the rule is right, and
 * the type is two fields. `pageRequest()`/`keysetFragment()` accept this value
 * unchanged because TypeScript structural typing makes the two identical; the
 * equivalence is pinned by a compile-time assignment in
 * `tests/foundation/p1-15-query-primitives.test.ts`, so a change to the
 * foundation type fails there rather than silently diverging.
 */
export interface OrderingContract {
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

export const MAX_FILTERS = 8;
export const MAX_IN_VALUES = 50;
export const MAX_FILTER_TEXT_LENGTH = 200;

export type FilterOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'prefix';

export type FilterValueType = 'uuid' | 'text' | 'timestamp' | 'integer' | 'boolean';

export interface FilterableField {
  /** Caller-visible name. Never used to build SQL. */
  readonly name: string;
  /** Column expression. A code constant — never derived from input. */
  readonly column: string;
  readonly type: FilterValueType;
  readonly operators: readonly FilterOperator[];
  /** Requires `iam.sensitive.view` to filter on. Filtering is a read oracle. */
  readonly sensitive?: boolean;
}

export interface SortableField {
  readonly name: string;
  readonly column: string;
}

export interface QueryContract {
  /** Stable ordering-contract key prefix, e.g. `shared.documents`. */
  readonly key: string;
  readonly filterable: readonly FilterableField[];
  readonly sortable: readonly SortableField[];
  /** Applied when the caller names none. */
  readonly defaultSort: { readonly field: string; readonly direction: 'asc' | 'desc' };
  /** Column holding the unique tie-breaker that makes the order total. */
  readonly idColumn: string;
}

export interface FilterInput {
  readonly field: string;
  readonly operator: FilterOperator;
  /** A scalar, or an array for `in`. Validated against the field type. */
  readonly value: string | number | boolean | readonly (string | number)[];
}

export interface SortInput {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

function reject(path: string, rule: string, message: string): never {
  throw new AppFailure('ERR-VAL-001', {
    message,
    // Path and rule only. The submitted value is never echoed: filter values are
    // business data and this error reaches logs.
    safeDetails: { violations: [{ path, rule }] },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Validates one scalar against a declared type; returns the bindable value. */
function coerceScalar(
  field: FilterableField,
  raw: string | number | boolean,
  path: string
): string | number | boolean {
  switch (field.type) {
    case 'uuid':
      if (typeof raw !== 'string' || !UUID.test(raw)) reject(path, 'invalid_uuid', 'Not a UUID');
      return (raw as string).toLowerCase();
    case 'text':
      if (typeof raw !== 'string') reject(path, 'invalid_type', 'Not a string');
      if ((raw as string).length > MAX_FILTER_TEXT_LENGTH) {
        reject(path, 'too_long', 'Filter text exceeds the permitted length');
      }
      return raw;
    case 'timestamp':
      if (typeof raw !== 'string' || !TIMESTAMP.test(raw)) {
        reject(path, 'invalid_timestamp', 'Not an ISO-8601 timestamp');
      }
      return raw;
    case 'integer':
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        reject(path, 'invalid_integer', 'Not an integer');
      }
      return raw;
    case 'boolean':
      if (typeof raw !== 'boolean') reject(path, 'invalid_boolean', 'Not a boolean');
      return raw;
  }
}

/** Escapes LIKE metacharacters so a prefix filter cannot become a wildcard scan. */
export function escapeLikePrefix(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export interface BuiltFilter {
  /** Fragment beginning with `AND`, or `''` when no filter applies. */
  readonly predicate: string;
  readonly values: readonly unknown[];
  /** The next free positional parameter index. */
  readonly nextParamIndex: number;
  /** Canonical form of the applied filters, for the cursor fingerprint. */
  readonly canonical: string;
}

/**
 * Builds the filter predicate.
 *
 * `mayReadSensitive` is passed in rather than looked up so this stays a pure
 * function: the caller resolved the permission once, and a rule that depends on
 * it can be unit-tested both ways without a database.
 */
export function buildFilterPredicate(
  contract: QueryContract,
  filters: readonly FilterInput[],
  startParamIndex: number,
  options: { readonly mayReadSensitive: boolean }
): BuiltFilter {
  if (filters.length > MAX_FILTERS) {
    reject('query.filter', 'too_many_filters', `At most ${MAX_FILTERS} filters may be applied`);
  }

  const clauses: string[] = [];
  const values: unknown[] = [];
  const canonicalParts: string[] = [];
  let index = startParamIndex;

  filters.forEach((filter, position) => {
    const path = `query.filter.${position}`;
    const field = contract.filterable.find((entry) => entry.name === filter.field);
    if (!field) {
      reject(path, 'unknown_field', 'Field is not filterable on this operation');
    }
    if (field.sensitive && !options.mayReadSensitive) {
      // Denied as a *validation* failure rather than silently dropped: dropping
      // it would return a wider result set than the caller asked for and look
      // like the filter worked.
      reject(path, 'sensitive_field', 'Filtering this field requires additional permission');
    }
    if (!field.operators.includes(filter.operator)) {
      reject(path, 'unsupported_operator', 'Operator is not supported for this field');
    }

    if (filter.operator === 'in') {
      if (!Array.isArray(filter.value)) reject(path, 'invalid_type', '`in` requires a list');
      const list = filter.value as readonly (string | number)[];
      if (list.length === 0) reject(path, 'empty_list', '`in` requires at least one value');
      if (list.length > MAX_IN_VALUES) {
        reject(path, 'list_too_long', `An \`in\` list may hold at most ${MAX_IN_VALUES} values`);
      }
      const coerced = list.map((entry) => coerceScalar(field, entry, path));
      clauses.push(`AND ${field.column} = ANY($${index}::${sqlArrayType(field.type)})`);
      values.push(coerced);
      canonicalParts.push(`${field.name}:in:${coerced.join(',')}`);
      index += 1;
      return;
    }

    if (Array.isArray(filter.value)) reject(path, 'invalid_type', 'Only `in` accepts a list');
    const scalar = coerceScalar(field, filter.value as string | number | boolean, path);

    if (filter.operator === 'prefix') {
      clauses.push(`AND ${field.column} LIKE $${index} ESCAPE '\\'`);
      values.push(`${escapeLikePrefix(String(scalar))}%`);
      canonicalParts.push(`${field.name}:prefix:${String(scalar)}`);
      index += 1;
      return;
    }

    clauses.push(`AND ${field.column} ${SQL_OPERATOR[filter.operator]} $${index}`);
    values.push(scalar);
    canonicalParts.push(`${field.name}:${filter.operator}:${String(scalar)}`);
    index += 1;
  });

  return {
    predicate: clauses.join(' '),
    values,
    nextParamIndex: index,
    canonical: canonicalParts.sort().join('|'),
  };
}

const SQL_OPERATOR: Readonly<Record<Exclude<FilterOperator, 'in' | 'prefix'>, string>> = {
  eq: '=',
  neq: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

function sqlArrayType(type: FilterValueType): string {
  switch (type) {
    case 'uuid':
      return 'uuid[]';
    case 'integer':
      return 'bigint[]';
    case 'timestamp':
      return 'timestamptz[]';
    case 'boolean':
      return 'boolean[]';
    case 'text':
      return 'text[]';
  }
}

export interface ResolvedSort {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly canonical: string;
}

/** Resolves the sort, falling back to the contract default. */
export function resolveSort(contract: QueryContract, requested: SortInput | undefined): ResolvedSort {
  const wanted = requested ?? contract.defaultSort;
  const field = contract.sortable.find((entry) => entry.name === wanted.field);
  if (!field) {
    reject('query.sort.field', 'unknown_field', 'Field is not sortable on this operation');
  }
  if (wanted.direction !== 'asc' && wanted.direction !== 'desc') {
    reject('query.sort.direction', 'invalid_direction', 'Direction must be asc or desc');
  }
  return {
    column: field.column,
    direction: wanted.direction,
    canonical: `${field.name}:${wanted.direction}`,
  };
}

/**
 * Ordering contract for a specific filter set, sort, and tenant.
 *
 * The fingerprint is truncated to 16 hex characters. That is a *collision*
 * budget, not a security one: two different filter sets colliding would let a
 * cursor be reused across them, which produces a wrong page and nothing worse.
 */
export function boundOrderingContract(
  contract: QueryContract,
  sort: ResolvedSort,
  filterCanonical: string,
  tenantId: string
): OrderingContract {
  const fingerprint = createHash('sha256')
    .update([contract.key, sort.canonical, filterCanonical, tenantId].join(' '))
    .digest('hex')
    .slice(0, 16);
  return { key: `${contract.key}#${fingerprint}`, direction: sort.direction };
}
