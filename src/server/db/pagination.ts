/**
 * Cursor pagination (P1-13-BE-006, database indexing governance).
 *
 * Offset pagination is not offered. At page 500 it makes the database count 500
 * pages of rows it will discard, and it silently skips or repeats rows when the
 * underlying set changes between requests. Cursor pagination costs one indexed
 * seek regardless of depth and is stable under concurrent inserts.
 *
 * The cursor is opaque to clients and **not** a security boundary: it is
 * base64url-encoded JSON, not encrypted, and it is validated against the
 * ordering contract it was issued for. Every query it feeds still runs under the
 * caller's context and RLS, so a forged cursor can at worst produce a bad page,
 * never another tenant's rows.
 *
 * Determinism requires a total order: the sort key is always `(sortValue, id)`,
 * with `id` breaking ties. Without the tie-breaker two rows sharing a timestamp
 * can straddle a page edge and be shown twice or never.
 */
import { AppFailure } from '../errors/app-failure';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** Ordering contract a cursor belongs to. Mismatch invalidates the cursor. */
export interface OrderingContract {
  /** Stable name, e.g. `crm.business_partners:created_at_desc`. */
  readonly key: string;
  readonly direction: 'asc' | 'desc';
}

export interface Cursor {
  /** The ordering contract key the cursor was issued for. */
  readonly k: string;
  /** Last seen sort value, as a string (ISO date, numeric string, or text). */
  readonly v: string;
  /** Last seen row id — the tie-breaker that makes the order total. */
  readonly i: string;
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor: Cursor | null;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Cursor for the next page, or null when the end has been reached. */
  readonly nextCursor: string | null;
  /** True when another page exists. */
  readonly hasMore: boolean;
}

/** Clamps a requested page size into the documented bounds. */
export function resolveLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new AppFailure('ERR-VAL-001', {
      message: 'Page size must be a positive integer',
      safeDetails: { violations: [{ path: 'query.limit', rule: 'invalid_type' }] },
    });
  }
  // Clamping rather than rejecting: a client asking for 1000 gets 100 and a
  // `hasMore` flag, which is more useful than an error and equally bounded.
  return Math.min(requested, MAX_PAGE_SIZE);
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decodes and validates a cursor against its ordering contract. */
export function decodeCursor(encoded: string, contract: OrderingContract): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new AppFailure('ERR-PAG-001', { message: 'Cursor is not decodable' });
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Cursor).k !== 'string' ||
    typeof (parsed as Cursor).v !== 'string' ||
    typeof (parsed as Cursor).i !== 'string'
  ) {
    throw new AppFailure('ERR-PAG-001', { message: 'Cursor shape is invalid' });
  }
  const cursor = parsed as Cursor;
  if (cursor.k !== contract.key) {
    // Re-using a cursor across orderings would silently produce a wrong page.
    throw new AppFailure('ERR-PAG-001', {
      message: 'Cursor was issued for a different ordering contract',
    });
  }
  return cursor;
}

/** Builds a page request from already-validated query input. */
export function pageRequest(
  contract: OrderingContract,
  input: { limit?: number; cursor?: string | undefined }
): PageRequest {
  return {
    limit: resolveLimit(input.limit),
    cursor: input.cursor ? decodeCursor(input.cursor, contract) : null,
  };
}

/**
 * Builds the keyset predicate and ordering for a page request.
 *
 * Returns SQL fragments plus the parameter values. The caller supplies column
 * names (they are code-controlled identifiers, never user input) and appends the
 * fragments to its own query — the layer stays a helper, not a query builder
 * that hides what runs.
 */
export function keysetFragment(
  request: PageRequest,
  columns: { readonly sort: string; readonly id: string },
  contract: OrderingContract,
  nextParamIndex: number
): { predicate: string; order: string; limitClause: string; values: unknown[] } {
  const comparison = contract.direction === 'desc' ? '<' : '>';
  const order = `ORDER BY ${columns.sort} ${contract.direction.toUpperCase()}, ${columns.id} ${contract.direction.toUpperCase()}`;
  const values: unknown[] = [];
  let predicate = '';
  let index = nextParamIndex;

  if (request.cursor) {
    // Row-value comparison gives the correct keyset semantics in one predicate
    // and lets PostgreSQL use the composite index directly.
    predicate = `AND (${columns.sort}, ${columns.id}) ${comparison} ($${index}, $${index + 1})`;
    values.push(request.cursor.v, request.cursor.i);
    index += 2;
  }

  // Fetch one extra row to detect `hasMore` without a second COUNT query.
  const limitClause = `LIMIT $${index}`;
  values.push(request.limit + 1);

  return { predicate, order, limitClause, values };
}

/** Trims the sentinel row and mints the next cursor. */
export function buildPage<T>(
  rows: readonly T[],
  request: PageRequest,
  contract: OrderingContract,
  read: (row: T) => { sortValue: string; id: string }
): Page<T> {
  const hasMore = rows.length > request.limit;
  const items = hasMore ? rows.slice(0, request.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ k: contract.key, v: read(last).sortValue, i: read(last).id })
      : null;
  return { items, nextCursor, hasMore };
}
