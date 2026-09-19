'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReadState } from '@/lib/api/read-operation';

/**
 * One cursor-paginated report read, a page at a time.
 *
 * ## Why this is not `useServerTable`
 *
 * The shared hook is right for a list whose only answer is its rows. A report's
 * answer is the whole envelope — the period, the zone it was resolved in, the
 * generation instant, the freshness, the filter context and the groups computed
 * over the entire selection — and **D-17** requires the period and the filter
 * context to be shown wherever the result is. `useServerTable` hands back rows
 * and a table status and discards everything else, so a screen built on it would
 * have to keep the envelope somewhere beside the rows, which is exactly how a
 * page of rows ends up displayed under the generation instant of a different
 * read.
 *
 * So this hook holds the whole outcome of ONE response, and every page carries
 * its own context. Nothing is accumulated across pages, and nothing about one
 * page is shown beside another page's rows.
 *
 * ## There are no page NUMBERS, deliberately
 *
 * The operation publishes `{ items, nextCursor, hasMore }` and no total, so
 * neither a page count nor a position in one exists. A pager showing "page 3 of
 * 9" would be inventing the nine. What exists is a trail of the cursors already
 * walked — which is what makes Previous a single request instead of a re-walk
 * from the start — and the server's own `hasMore`, which is what makes Next an
 * offer rather than a guess.
 *
 * ## Race handling
 *
 * A `cancelled` flag per effect run, checked before the state write, and the
 * held outcome records WHICH request produced it. Without the first, a slow
 * earlier response landing after a fast later one would overwrite the page the
 * operator has already moved past. Without the second, "loading" could not be
 * distinguished from "holding a page for a request that has since changed", and
 * a stale page would be shown as though it were current.
 *
 * ## The trail is never advanced from inside the effect
 *
 * Next is a click, and at the moment of the click the cursor that opens the next
 * page is already held on the response. Advancing the trail there rather than in
 * the effect keeps the effect a pure function of its inputs — which is what lets
 * its dependency list be complete and honest rather than exempted.
 */
export interface CursorTrail<T> {
  /** True while the read for the requested page is in flight. */
  readonly loading: boolean;
  /** The outcome of the CURRENT page, or `null` while the first read is in flight. */
  readonly outcome: ReadState<T> | null;
  /** How many pages back the operator can step. */
  readonly canGoBack: boolean;
  /** The server's own signal that a further page exists. */
  readonly canGoForward: boolean;
  readonly goBack: () => void;
  readonly goForward: () => void;
}

/** What the caller reads off a successful response so the trail can advance. */
export interface PageSignals {
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export function useCursorTrail<T>(
  /** Reads one page. Must be stable — wrap it in `useCallback`. */
  read: (cursor: string | null) => Promise<ReadState<T>>,
  /** Reads the end-of-set signals off a successful response. Must be stable. */
  signals: (data: T) => PageSignals
): CursorTrail<T> {
  // Index 0 is the first page, whose cursor is always absent.
  const [trail, setTrail] = useState<readonly (string | null)[]>([null]);
  const [depth, setDepth] = useState(0);
  const [held, setHeld] = useState<{ readonly key: string; readonly outcome: ReadState<T> } | null>(
    null
  );

  const cursor = trail[depth] ?? null;
  const wanted = `${String(depth)}#${cursor ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    // Awaited before any state write, so nothing here is a synchronous state
    // change inside an effect body.
    void read(cursor).then((outcome) => {
      if (cancelled) return;
      setHeld({ key: wanted, outcome });
    });
    return () => {
      cancelled = true;
    };
  }, [read, cursor, wanted]);

  const loading = held === null || held.key !== wanted;
  const outcome = loading ? null : held.outcome;
  const forward =
    outcome !== null && outcome.status === 'ok'
      ? signals(outcome.data)
      : { nextCursor: null, hasMore: false };

  const goForward = useCallback(() => {
    const next = forward.nextCursor;
    if (!forward.hasMore || next === null) return;
    setTrail((current) => (current.length > depth + 1 ? current : [...current, next]));
    setDepth(depth + 1);
  }, [depth, forward.hasMore, forward.nextCursor]);

  const goBack = useCallback(() => {
    if (depth === 0) return;
    setDepth(depth - 1);
  }, [depth]);

  return {
    loading,
    outcome,
    canGoBack: depth > 0,
    canGoForward: forward.hasMore && forward.nextCursor !== null,
    goBack,
    goForward,
  };
}
