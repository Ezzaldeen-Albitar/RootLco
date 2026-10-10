'use client';

import { useCallback, useEffect, useState } from 'react';
import { isCancelledRead } from '@/lib/api/browser-read';
import type { ReadState } from '@/lib/api/read-operation';
import type { Outstanding } from './billing-contract';
import { readOutstandingCancellable } from './outstanding-read';

/**
 * Where a printable copy's "Payments and credits as of" section stands (DX-2,
 * finance QA fixes E).
 *
 * - `none` — the copy carries no settlement at all: a draft or voided invoice
 *   claims nothing, and a reader who may not see amounts is shown none;
 * - `reading` — the balance read is still out, so the copy waits for it;
 * - `read` — the server's balance, printed as it was read;
 * - `unavailable` — the read was refused, failed or did not answer in time, and
 *   the copy says so rather than printing as if nothing had been paid.
 */
export type SettlementRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly balance: Outstanding }
  | { readonly kind: 'unavailable' };

/** The settlement a copy prints, from the balance read and whether it applies. */
export function settlementOf(
  state: ReadState<Outstanding> | null,
  applies: boolean
): SettlementRead {
  if (!applies) return { kind: 'none' };
  if (state === null) return { kind: 'reading' };
  return state.status === 'ok' ? { kind: 'read', balance: state.data } : { kind: 'unavailable' };
}

/**
 * The balance of one invoice, read through the cancellable route and never
 * through a Server Action, so a stalled action on the page — the buyer-name
 * lookup above all — cannot hold it up (`outstanding-read.ts` says why).
 *
 * `key` names the question: `null` asks nothing (a draft, or a reader who may
 * not see amounts), and a new key — the invoice, or its version after a change
 * — abandons the read in flight, whose late answer is then dropped. The wait is
 * bounded by `browserRead`'s own ceiling, which answers `unavailable`, and
 * `retry` asks again. `null` while the read is out.
 */
export function useOutstandingRead(
  invoiceId: string | null,
  key: string | null
): { readonly state: ReadState<Outstanding> | null; readonly retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly state: ReadState<Outstanding>;
  } | null>(null);
  const asked = key === null ? null : `${key}#${attempt}`;
  useEffect(() => {
    if (asked === null || invoiceId === null) return;
    const controller = new AbortController();
    let live = true;
    readOutstandingCancellable(invoiceId, controller.signal)
      .then((state) => {
        if (live) setHeld({ key: asked, state });
      })
      .catch((error: unknown) => {
        if (!live || isCancelledRead(error)) return;
        setHeld({ key: asked, state: { status: 'unavailable', correlationId: null } });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [asked, invoiceId]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    state: asked !== null && held !== null && held.key === asked ? held.state : null,
    retry,
  };
}
