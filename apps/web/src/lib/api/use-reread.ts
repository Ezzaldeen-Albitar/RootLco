'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadState } from './read-operation';
import { settleRead } from './use-search-request';

/**
 * One read a panel shows, asked for again after a write — and AWAITED.
 *
 * ## The gap it closes
 *
 * The work-order detail, the closure view, the diagnostics workbench and the
 * technician's job panel each held their reads as "a counter the effect is
 * keyed on": a write bumped the counter and the effect read again. That is a
 * correct way to re-read and a useless way to WAIT for one — the form that made
 * the write had no promise to hold, so it said "done" and offered its submit
 * again while the re-read that would show the new record was still in flight.
 * A second press in that window sends the same write twice (after a success)
 * or re-sends a stale version (after a conflict). The reception forms of #481
 * close the same window by keeping their submit busy through the re-read
 * (`useStepForm`); this is the read half of that rule for every other panel:
 * `reload()` resolves once the new answer is on screen.
 *
 * ## The rules
 *
 * - **The read is the caller's `useCallback`.** Its identity IS the key: a new
 *   function (a different record, a different job) is a new read, and the old
 *   answer is not shown under it — `value` is `null` until the new one lands.
 * - **A re-read keeps the answer on screen.** While `reload()` is in flight the
 *   previous answer stays; nothing flashes back to "Loading".
 * - **Only the newest read is written.** Every read takes a ticket, and an
 *   answer whose ticket is no longer the newest — superseded by a later reload,
 *   by a change of read, or by unmounting — is dropped, never painted over a
 *   newer one.
 * - **Settled, never hanging.** A read that rejects or outlives the product's
 *   read ceiling (`settleRead`) is the outage it is — `unavailable`, which the
 *   Material states offer a retry for — rather than "Loading" for ever.
 * - **`null` reads nothing.** A panel without the authority for a read passes
 *   `null`, and no request is issued.
 */
export interface Reread<T> {
  /** The newest answer for the current read, or `null` while its first answer is in flight. */
  readonly value: ReadState<T> | null;
  /** Reads again. Resolves once the answer is on screen, or once it was superseded. */
  readonly reload: () => Promise<void>;
}

const UNAVAILABLE = { status: 'unavailable', correlationId: null } as const;

export function useReread<T>(read: (() => Promise<ReadState<T>>) | null): Reread<T> {
  const [held, setHeld] = useState<{
    readonly source: () => Promise<ReadState<T>>;
    readonly value: ReadState<T>;
  } | null>(null);
  const newest = useRef(0);

  useEffect(() => {
    if (read === null) return undefined;
    newest.current += 1;
    const ticket = newest.current;
    void (async () => {
      const value = await settleRead<ReadState<T>>(read, UNAVAILABLE);
      if (ticket !== newest.current) return;
      setHeld({ source: read, value });
    })();
    return () => {
      // Whatever this read still owes is no longer wanted.
      newest.current += 1;
    };
  }, [read]);

  const reload = useCallback(async () => {
    if (read === null) return;
    newest.current += 1;
    const ticket = newest.current;
    const value = await settleRead<ReadState<T>>(read, UNAVAILABLE);
    if (ticket !== newest.current) return;
    setHeld({ source: read, value });
  }, [read]);

  return { value: held !== null && held.source === read ? held.value : null, reload };
}
