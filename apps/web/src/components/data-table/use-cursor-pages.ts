'use client';

import { useCallback, useMemo, useState } from 'react';
import type { TableRequest } from './table-state';

/**
 * Page numbers over a cursor-paginated backend.
 *
 * The backend hands back `{ items, nextCursor, hasMore }` and no count. An
 * operator still thinks in pages and still presses Previous, so something has to
 * bridge the two — and the naive bridge is to re-query from the start and skip,
 * which is O(n) requests to go back one page.
 *
 * This keeps the cursor that OPENED each visited page. Page 1's cursor is
 * `null`; page N's is the `nextCursor` page N−1 returned. Going back is then a
 * single request with a cursor already held.
 *
 * ## What it deliberately does not do
 *
 * It does not let a caller jump to an arbitrary page. Pages are reachable only
 * in the order they were walked, because a cursor for page 7 does not exist
 * until page 6 has been read. A control offering page 7 would either fail or
 * silently land somewhere else.
 *
 * Any change to sorting, filters, page size or search **resets the stack**. A
 * cursor is issued against an ordering contract; spending one from a previous
 * ordering returns a window of a set that no longer exists, and the rows look
 * plausible.
 */
export interface CursorPages {
  /** The cursor to send for the requested page, or null for the first page. */
  readonly cursorFor: (page: number) => string | null;
  /** Records the cursor that opens the NEXT page after `page`. */
  readonly remember: (page: number, nextCursor: string | null) => void;
  /** The highest page whose cursor is known — the furthest Next may go. */
  readonly furthestKnownPage: number;
  /** Drops every cursor. Call when the ordering contract changes. */
  readonly reset: () => void;
}

/** The parts of a request that invalidate every held cursor when they change. */
export function orderingKeyOf(request: TableRequest): string {
  return JSON.stringify({
    pageSize: request.pageSize,
    sort: request.sort,
    filters: [...request.filters].sort((a, b) =>
      `${a.key}:${a.value}`.localeCompare(`${b.key}:${b.value}`)
    ),
    search: request.search,
  });
}

export function useCursorPages(orderingKey: string): CursorPages {
  // Page 1 always opens with no cursor. Index 0 is page 1.
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  // STATE, not a ref. React's documented "adjust state when a prop changes"
  // pattern: the comparison value has to participate in rendering, and a ref
  // read during render is both flagged by `react-hooks/refs` and wrong under
  // concurrent rendering — a discarded render would leave the ref advanced and
  // the reset would never happen.
  const [lastOrdering, setLastOrdering] = useState(orderingKey);

  // Adjusted DURING render rather than in an effect: an effect would let one
  // render happen against the previous ordering's cursors, which is exactly the
  // "plausible rows from a set that no longer exists" failure this guards.
  if (lastOrdering !== orderingKey) {
    setLastOrdering(orderingKey);
    setCursors([null]);
  }

  const cursorFor = useCallback(
    (page: number) => {
      const index = Math.max(0, page - 1);
      return cursors[index] ?? null;
    },
    [cursors]
  );

  const remember = useCallback((page: number, nextCursor: string | null) => {
    if (nextCursor === null) return;
    setCursors((current) => {
      const index = page; // the cursor that OPENS page+1
      if (current[index] === nextCursor) return current;
      const next = [...current];
      next[index] = nextCursor;
      return next;
    });
  }, []);

  const reset = useCallback(() => setCursors([null]), []);

  const furthestKnownPage = useMemo(() => cursors.length, [cursors]);

  return { cursorFor, remember, furthestKnownPage, reset };
}
