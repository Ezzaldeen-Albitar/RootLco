'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TableStatus } from './DataTable';
import { INITIAL_REQUEST, type TableRequest, type TableResponse } from './table-state';
import { orderingKeyOf, useCursorPages } from './use-cursor-pages';

/**
 * A server-driven table over a cursor-paginated operation.
 *
 * ## Why this lives beside the table rather than under a feature (P1-27)
 *
 * It was written for administration and was never about administration. P1-27
 * needed the identical hook for CRM and Vehicle, and copying it would have made
 * a second authority for cursor-page bookkeeping and race handling — the two
 * things in this file that are subtle enough to get wrong differently in two
 * places. `features/administration/shared/use-server-table` re-exports, so no
 * P1-26 screen changed.
 *
 * ## Why the data comes from a Server Action and not a browser fetch
 *
 * The bearer token lives in a `httpOnly` cookie the browser cannot read, so the
 * browser could not attach it even if it wanted to. Every read goes through a
 * Server Action, which runs with the cookie and returns a view model. The token
 * never enters the client bundle, the client heap, or a network tab.
 *
 * ## Why loading is derived rather than stored
 *
 * Setting `'loading'` synchronously at the top of the effect is what
 * `react-hooks/set-state-in-effect` catches, and the rule is right — it causes a
 * cascading render on every keystroke of a search box. Instead the hook records
 * WHICH request produced the page it is holding, and "loading" is simply
 * `holding !== wanted`. One state, no cascade, and a stale page cannot be shown
 * as if it were current.
 *
 * ## Race handling
 *
 * A `cancelled` flag per effect run, checked before every state write. Without
 * it a slow page-1 response that lands after a fast page-2 response overwrites
 * page 2 with page 1, and the table shows rows from a request the operator has
 * already moved past.
 */

export type ServerPageStatus = 'ok' | 'denied' | 'expired' | 'unavailable' | 'error' | 'not-found';

export interface ServerPage<Row> {
  readonly status: ServerPageStatus;
  readonly rows: readonly Row[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly correlationId: string | null;
  /** Set only when the operation returns a complete, uncounted-but-whole set. */
  readonly total?: number | null;
}

export interface ServerTable<Row> {
  readonly request: TableRequest;
  readonly setRequest: (next: TableRequest) => void;
  readonly response: TableResponse<Row> | null;
  readonly status: TableStatus;
  readonly correlationId: string | undefined;
  /** Forces a re-read of the current page — used after a mutation succeeds. */
  readonly refresh: () => void;
}

export function useServerTable<Row>(
  load: (request: TableRequest, cursor: string | null) => Promise<ServerPage<Row>>,
  options: {
    readonly initial?: TableRequest;
    /**
     * Anything OUTSIDE the table request that changes what `load` returns.
     *
     * The audit screen's date range is the case this exists for. It lives in the
     * screen, not in `TableRequest`, so changing it changed the `load` closure
     * and nothing else — the effect key did not move, the effect did not re-run,
     * and the operator changed the dates and watched the same rows sit there
     * (finding `P1-26-F-019`).
     *
     * Including `load` in the dependency array is not the fix: a loader defined
     * inline is a new function every render, which re-reads on every render.
     * The caller states what actually varies.
     */
    readonly loadKey?: string;
  } = {}
): ServerTable<Row> {
  const [request, setRequest] = useState<TableRequest>(options.initial ?? INITIAL_REQUEST);
  const [generation, setGeneration] = useState(0);
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly page: ServerPage<Row>;
  } | null>(null);

  const ordering = orderingKeyOf(request);
  const cursors = useCursorPages(`${ordering}#${options.loadKey ?? ''}`);
  const wanted = `${ordering}#${options.loadKey ?? ''}#${request.page}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Awaited before any state write, so nothing here is a synchronous
      // setState inside an effect body.
      const page = await load(request, cursors.cursorFor(request.page));
      if (cancelled) return;
      setHeld({ key: wanted, page });
      if (page.status === 'ok') cursors.remember(request.page, page.nextCursor);
    })();
    return () => {
      cancelled = true;
    };
    // `cursors` is stable per ordering; including it would re-run the read every
    // time a cursor is remembered, which is an infinite loop by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const loading = held === null || held.key !== wanted;
  const page = held?.page;

  const status: TableStatus = loading
    ? 'loading'
    : page?.status === 'denied'
      ? 'denied'
      : page && page.status !== 'ok'
        ? 'error'
        : 'idle';

  const response = useMemo<TableResponse<Row> | null>(() => {
    if (loading || !page || page.status !== 'ok') return null;
    return {
      rows: page.rows,
      // `total` is only present when the operation returns a complete set.
      // Everywhere else it is null, which the table renders as "no count
      // published" rather than as a number it made up.
      total: page.total ?? null,
      page: request.page,
      pageSize: request.pageSize,
      hasMore: page.hasMore,
    };
  }, [loading, page, request.page, request.pageSize]);

  return {
    request,
    setRequest,
    response,
    status,
    correlationId: page?.correlationId ?? undefined,
    refresh: () => setGeneration((value) => value + 1),
  };
}
