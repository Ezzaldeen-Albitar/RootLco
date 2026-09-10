'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReadState } from '@/lib/api/read-operation';
import type { DeliveryPage } from '../delivery-contract';

/**
 * One paged delivery list, read from the panel that shows it.
 *
 * The three paged delivery reads — signatures, checklist results and the status
 * ledger — share exactly this behaviour, and sharing it is the point: three
 * hand-written copies of "read the first page, keep the outcome, append the
 * next" is three places for the end-of-set signal to be read differently.
 *
 * ## The first outcome is kept, not flattened into the rows
 *
 * `first` holds the whole `ReadState` of the FIRST read so the panel can tell a
 * refusal from an empty ledger. Flattening to an array would render both as
 * "nothing here", which is the single most misleading thing a permission-gated
 * screen can say.
 *
 * ## What is held remembers WHICH delivery it is about
 *
 * State carries the identifier it was read for, and a value read for a
 * different delivery is treated as absent rather than shown. That is why nothing
 * here clears state as the effect starts: a synchronous reset inside an effect
 * is a second render pass, and — more importantly — it would leave a window in
 * which the panel showed one delivery's ledger under another delivery's heading.
 * Comparing the identifier closes the window instead of narrowing it.
 *
 * ## The end of the set is the server's to declare
 *
 * `hasMore` and `nextCursor` come from the response. Nothing here infers the end
 * from a short page, and no total is requested or invented — the reads publish
 * none.
 *
 * ## A failed "load more" leaves what is already on screen
 *
 * The operator keeps the pages they have. Wiping them to report a transient
 * fault loses their place for no benefit; the failure is reported beside the
 * button that caused it.
 */
export interface PagedList<E, T> {
  /** The first read's outcome, `null` while it is still in flight. */
  readonly first: ReadState<E> | null;
  /** Every row loaded so far, in the order the server returned them. */
  readonly rows: readonly T[];
  /** The server's own signal that another page exists. */
  readonly hasMore: boolean;
  /** True while a further page is being read. */
  readonly loading: boolean;
  /** The outcome of a failed further page, or `null`. */
  readonly moreFailed: string | null;
  readonly loadMore: () => Promise<void>;
}

/** What is held, and the read it belongs to. */
interface Held<E, T> {
  readonly key: string;
  readonly first: ReadState<E>;
  readonly pages: readonly DeliveryPage<T>[];
  readonly moreFailed: string | null;
}

/**
 * The identity of a held list: the delivery, and how many writes ago it was read.
 *
 * `revision` is bumped by the screen after every successful write. Folding it
 * into the key rather than adding a second comparison means a list read before a
 * write is treated as ABSENT once the write lands, exactly as a list read for a
 * different delivery is — so a stale ledger cannot sit under a heading that has
 * moved on, and the panel shows its loading state while the fresh read is in
 * flight instead of showing yesterday's answer.
 */
const keyOf = (deliveryId: string, revision: number) => `${deliveryId}#${String(revision)}`;

export function usePagedList<E, T>(
  deliveryId: string,
  reader: (deliveryId: string, cursor: string | null) => Promise<ReadState<E>>,
  select: (envelope: E) => DeliveryPage<T>,
  revision = 0
): PagedList<E, T> {
  const [held, setHeld] = useState<Held<E, T> | null>(null);
  const [loading, setLoading] = useState(false);
  const key = keyOf(deliveryId, revision);

  useEffect(() => {
    let cancelled = false;
    void reader(deliveryId, null).then((first) => {
      if (cancelled) return;
      setHeld({
        key,
        first,
        pages: first.status === 'ok' ? [select(first.data)] : [],
        moreFailed: null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [deliveryId, key, reader, select]);

  const current = held !== null && held.key === key ? held : null;
  const last = current?.pages.at(-1) ?? null;

  const loadMore = useCallback(async () => {
    if (current === null || last === null || !last.hasMore || last.nextCursor === null) return;
    if (loading) return;
    setLoading(true);
    const next = await reader(deliveryId, last.nextCursor);
    setLoading(false);
    setHeld((previous) => {
      if (previous === null || previous.key !== key) return previous;
      if (next.status !== 'ok') return { ...previous, moreFailed: next.status };
      return { ...previous, pages: [...previous.pages, select(next.data)], moreFailed: null };
    });
  }, [current, deliveryId, key, last, loading, reader, select]);

  return {
    first: current?.first ?? null,
    rows: current === null ? [] : current.pages.flatMap((page) => [...page.items]),
    hasMore: last?.hasMore ?? false,
    loading,
    moreFailed: current?.moreFailed ?? null,
    loadMore,
  };
}
