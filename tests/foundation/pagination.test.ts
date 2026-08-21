/**
 * Protects the properties that make cursor pagination *correct*, not merely
 * present.
 *
 * Three of them silently produce wrong pages rather than errors, which is why
 * they are asserted rather than reviewed: an unbounded limit lets one request
 * drag an unbounded result set through the pool; a cursor accepted across
 * ordering contracts returns a page from the wrong position while looking
 * perfectly healthy; and a keyset predicate with the wrong parameter indexes
 * binds the cursor values to someone else's placeholders.
 *
 * The sentinel-row trick (`LIMIT n + 1`) is what avoids a second COUNT query, so
 * the trimming behaviour is part of the contract too.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPage,
  buildPageWithCursors,
  cursorTimestamp,
  decodeCursor,
  encodeCursor,
  keysetFragment,
  pageRequest,
  resolveLimit,
  type Cursor,
  type OrderingContract,
  type PageRequest,
} from '@/server/db/pagination';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';

const DESC: OrderingContract = { key: 'crm.business_partners:created_at_desc', direction: 'desc' };
const ASC: OrderingContract = { key: 'crm.business_partners:created_at_asc', direction: 'asc' };

const CURSOR: Cursor = {
  k: DESC.key,
  v: '2026-07-21T00:00:00.000Z',
  i: '0f6a2f1e-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
};

interface Row {
  readonly id: string;
  readonly createdAt: string;
}

function captureFailure(run: () => unknown): AppFailure {
  try {
    run();
  } catch (error) {
    if (isAppFailure(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw an AppFailure');
}

describe('resolveLimit', () => {
  it('defaults to the documented page size when the client asks for nothing', () => {
    expect(resolveLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(DEFAULT_PAGE_SIZE).toBe(50);
  });

  it('clamps an oversized request rather than failing it', () => {
    expect(resolveLimit(1_000)).toBe(MAX_PAGE_SIZE);
    expect(resolveLimit(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it('passes a legitimate size through unchanged', () => {
    expect(resolveLimit(1)).toBe(1);
    expect(resolveLimit(25)).toBe(25);
  });

  it.each([0, -1, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p as a page size',
    (requested) => {
      const failure = captureFailure(() => resolveLimit(requested));
      expect(failure.code).toBe('ERR-VAL-001');
      expect(failure.safeDetails.violations).toEqual([
        { path: 'query.limit', rule: 'invalid_type' },
      ]);
    }
  );
});

describe('cursor encoding', () => {
  it('round-trips through base64url', () => {
    expect(decodeCursor(encodeCursor(CURSOR), DESC)).toEqual(CURSOR);
  });

  it('produces a URL-safe token with no padding', () => {
    expect(encodeCursor(CURSOR)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects a cursor issued for a different ordering contract', () => {
    const failure = captureFailure(() => decodeCursor(encodeCursor(CURSOR), ASC));
    expect(failure.code).toBe('ERR-PAG-001');
    expect(failure.status).toBe(400);
  });

  it('rejects a corrupt token', () => {
    const truncated = Buffer.from('{"k":"crm', 'utf8').toString('base64url');
    expect(captureFailure(() => decodeCursor(truncated, DESC)).code).toBe('ERR-PAG-001');
    expect(captureFailure(() => decodeCursor('not a cursor at all', DESC)).code).toBe(
      'ERR-PAG-001'
    );
  });

  it('rejects a well-formed JSON document that is not a cursor', () => {
    const wrongShape = Buffer.from(JSON.stringify({ k: DESC.key, v: 1, i: 2 }), 'utf8').toString(
      'base64url'
    );
    expect(captureFailure(() => decodeCursor(wrongShape, DESC)).code).toBe('ERR-PAG-001');

    const notAnObject = Buffer.from(JSON.stringify('cursor'), 'utf8').toString('base64url');
    expect(captureFailure(() => decodeCursor(notAnObject, DESC)).code).toBe('ERR-PAG-001');
  });

  it('never leaks the cursor content into the caller-visible detail', () => {
    const failure = captureFailure(() => decodeCursor(encodeCursor(CURSOR), ASC));
    expect(JSON.stringify(failure.safeDetails)).not.toContain(CURSOR.i);
  });
});

describe('pageRequest', () => {
  it('builds a first-page request when no cursor is supplied', () => {
    expect(pageRequest(DESC, {})).toEqual({ limit: DEFAULT_PAGE_SIZE, cursor: null });
  });

  it('decodes a supplied cursor against the contract', () => {
    const request = pageRequest(DESC, { limit: 10, cursor: encodeCursor(CURSOR) });
    expect(request.limit).toBe(10);
    expect(request.cursor).toEqual(CURSOR);
  });
});

describe('keysetFragment', () => {
  it('emits a row-value predicate with consecutive parameter indexes', () => {
    const request: PageRequest = { limit: 25, cursor: CURSOR };
    const fragment = keysetFragment(request, { sort: 'created_at', id: 'id' }, DESC, 3);

    expect(fragment.predicate).toBe('AND (created_at, id) < ($3, $4)');
    expect(fragment.order).toBe('ORDER BY created_at DESC, id DESC');
    expect(fragment.limitClause).toBe('LIMIT $5');
    // The sentinel row is what makes `hasMore` free.
    expect(fragment.values).toEqual([CURSOR.v, CURSOR.i, 26]);
  });

  it('flips the comparison and the ordering for an ascending contract', () => {
    const request: PageRequest = { limit: 10, cursor: { ...CURSOR, k: ASC.key } };
    const fragment = keysetFragment(request, { sort: 'created_at', id: 'id' }, ASC, 1);

    expect(fragment.predicate).toBe('AND (created_at, id) > ($1, $2)');
    expect(fragment.order).toBe('ORDER BY created_at ASC, id ASC');
    expect(fragment.limitClause).toBe('LIMIT $3');
  });

  it('emits no predicate on the first page and still binds the limit correctly', () => {
    const request: PageRequest = { limit: 50, cursor: null };
    const fragment = keysetFragment(request, { sort: 'created_at', id: 'id' }, DESC, 2);

    expect(fragment.predicate).toBe('');
    expect(fragment.limitClause).toBe('LIMIT $2');
    expect(fragment.values).toEqual([51]);
  });
});

describe('buildPage', () => {
  const read = (row: Row) => ({ sortValue: row.createdAt, id: row.id });
  // UUIDs rather than `row-0`: every paginated relation in this schema has a
  // `uuid` primary key, and P1-15-SR-013 made `decodeCursor` say so — a cursor
  // whose tie-breaker is not a UUID is now `ERR-PAG-001` instead of reaching
  // PostgreSQL and raising 22P02 as a 500. The fixture matches the real shape.
  const idOf = (index: number): string =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const rowsOf = (count: number): Row[] =>
    Array.from({ length: count }, (_unused, index) => ({
      id: idOf(index),
      createdAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));

  it('trims the sentinel row and mints a cursor pointing at the last returned row', () => {
    const request: PageRequest = { limit: 3, cursor: null };
    const page = buildPage(rowsOf(4), request, DESC, read);

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(3);
    expect(page.items.map((row) => row.id)).toEqual([idOf(0), idOf(1), idOf(2)]);
    expect(page.nextCursor).not.toBeNull();

    const decoded = decodeCursor(page.nextCursor!, DESC);
    expect(decoded).toEqual({ k: DESC.key, v: '2026-07-03T00:00:00.000Z', i: idOf(2) });
  });

  it('mints no cursor when the page is the last one', () => {
    const request: PageRequest = { limit: 3, cursor: null };
    const page = buildPage(rowsOf(3), request, DESC, read);

    expect(page.hasMore).toBe(false);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result set without inventing a cursor', () => {
    const page = buildPage([], { limit: 10, cursor: null }, DESC, read);
    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});

/**
 * `P1-27-INT-006` — the cursor key is NOT the published timestamp.
 *
 * `pg` decodes `timestamptz` into a JS `Date`, which holds milliseconds while
 * PostgreSQL stores microseconds, and the decoder TRUNCATES. A cursor minted
 * from that `Date` is strictly earlier than the row it points at, so the
 * descending predicate `(sort, id) < ($v, $i)` is false for every row sharing
 * the boundary's millisecond — the id tie-break is never reached and those rows
 * are silently skipped.
 *
 * Measured against the real database in
 * `tests/backend/p1-27-cursor-precision.test.ts`: ten rows at one instant, read
 * at `limit=4`, returned 4 then **0** of the remaining 6.
 *
 * These tests pin the mechanism that fixes it: the caller states the cursor key
 * separately from the item, so the two cannot be conflated by accident.
 */
describe('cursorTimestamp', () => {
  it('renders microseconds, in UTC, in a form that casts back to timestamptz', () => {
    // The format string is the contract. `US` is microseconds; `MS` would be the
    // very truncation this exists to avoid, and is the plausible wrong edit.
    expect(cursorTimestamp('c.detected_at')).toBe(
      `to_char(c.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    );
  });

  it('interpolates the column verbatim, so a qualified name survives', () => {
    // Qualification matters: an unqualified ORDER BY can bind to an output
    // column rather than the table column it was aliased from.
    expect(cursorTimestamp('a.assigned_at')).toContain('a.assigned_at AT TIME ZONE');
  });
});

describe('buildPageWithCursors', () => {
  const idOf = (index: number): string =>
    `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

  /**
   * Every row shares one millisecond and differs only in microseconds — the
   * exact shape a batch written in one transaction produces, and the shape a
   * `Date`-derived cursor cannot distinguish.
   */
  const rowsOf = (count: number) =>
    Array.from({ length: count }, (_unused, index) => ({
      item: { id: idOf(index), createdAt: '2026-08-04T10:00:00.123Z' },
      sortValue: `2026-08-04T10:00:00.123${String(index).padStart(3, '0')}Z`,
      id: idOf(index),
    }));

  it('mints the cursor from the stated key, not from the published item', () => {
    const page = buildPageWithCursors(rowsOf(4), { limit: 3, cursor: null }, DESC);

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(3);
    // The published field is the millisecond string on every row...
    expect(page.items.map((row) => row.createdAt)).toEqual([
      '2026-08-04T10:00:00.123Z',
      '2026-08-04T10:00:00.123Z',
      '2026-08-04T10:00:00.123Z',
    ]);
    // ...and the cursor carries the microsecond one. Had it taken the published
    // value, all four rows would collide and the next page would return none.
    const decoded = decodeCursor(page.nextCursor!, DESC);
    expect(decoded.v).toBe('2026-08-04T10:00:00.123002Z');
    expect(decoded.i).toBe(idOf(2));
  });

  it('publishes only the item, never the cursor key', () => {
    const page = buildPageWithCursors(rowsOf(2), { limit: 5, cursor: null }, DESC);
    // A leaked `sortValue` would put a second, differently-precise timestamp on
    // the wire beside the published one.
    expect(page.items).toEqual([
      { id: idOf(0), createdAt: '2026-08-04T10:00:00.123Z' },
      { id: idOf(1), createdAt: '2026-08-04T10:00:00.123Z' },
    ]);
    expect(Object.keys(page.items[0]!)).toEqual(['id', 'createdAt']);
  });

  it('mints no cursor when the page is the last one', () => {
    const page = buildPageWithCursors(rowsOf(3), { limit: 3, cursor: null }, DESC);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles an empty result set without inventing a cursor', () => {
    const page = buildPageWithCursors([], { limit: 10, cursor: null }, DESC);
    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('binds the cursor to the contract it was issued for', () => {
    const page = buildPageWithCursors(rowsOf(4), { limit: 3, cursor: null }, DESC);
    // Same guarantee `buildPage` has: replaying a cursor against another
    // ordering is `ERR-PAG-001`, not a plausible wrong page.
    const failure = captureFailure(() => decodeCursor(page.nextCursor!, ASC));
    expect(failure.code).toBe('ERR-PAG-001');
  });
});
