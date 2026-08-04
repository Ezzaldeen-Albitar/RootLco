'use client';

import { useEffect } from 'react';

/**
 * Restores the main region's scroll position across Back and Forward.
 *
 * ## Why this has to exist at all
 *
 * Browsers persist and restore `window.scrollY` for every history entry, for
 * free. They do **not** restore a `<div>`'s `scrollTop` — there is no API that
 * asks them to, because a document has one scroll position and an application
 * may have many.
 *
 * The scroll-ownership contract (ADR-021) moved the application's scroll from
 * the document into `main`, which is what stopped the document growing past the
 * viewport. The cost, measured rather than assumed, is exactly this: scroll to
 * row 80, follow a link, press Back — and you land at row 1.
 *
 *   before this hook   left at 1500, returned to 0
 *   after              left at 1500, returned to 1500
 *
 * That is a regression introduced by fixing something else, and the honest
 * response is to repay it rather than to document it and move on.
 *
 * ## In memory, and NOT in browser storage
 *
 * The first version used `sessionStorage`, and the P1-26 frontend gate refused
 * it: *"reaches for browser storage; a session or token there is readable by any
 * script"*. The gate is right to be suspicious, and following it produced the
 * better design rather than a weaker gate.
 *
 * This hook only ever restores on `popstate`, which fires for **same-document**
 * history traversal. A cross-document Back — a real reload — does not fire it,
 * so a durable store could never have been read on that path anyway. Module
 * memory survives precisely the navigations that matter and is discarded
 * precisely when it would have been useless. It also means nothing about where
 * the operator has been is written anywhere a script can read.
 *
 * ## Keyed by history entry where the browser offers one
 *
 * Two visits to the same URL are two places a person can be. Next 16 does not
 * put a `key` on `history.state` — measured: it carries `__NA` and
 * `__PRIVATE_NEXTJS_INTERNALS_TREE` and nothing else — so the URL is the key in
 * practice. That is weaker (two entries for one address share a position) and
 * never wrong. The `key` branch is kept for the day the router publishes one.
 */

/** Bounded so a long session cannot grow it without limit. */
const MAX_ENTRIES = 50;

/**
 * Module-level, deliberately.
 *
 * `AppShell` mounts once per document, so this map has exactly one owner, and it
 * dies with the document — which is the same moment `popstate` stops being able
 * to deliver a restore.
 */
const positions = new Map<string, number>();

/** The identity of the current history entry. */
function entryKey(): string {
  const state = history.state as { key?: unknown } | null;
  return typeof state?.key === 'string' ? state.key : `url:${location.pathname}${location.search}`;
}

function record(key: string, top: number): void {
  // Re-insert so the map's iteration order is least-recently-used first.
  positions.delete(key);
  positions.set(key, top);
  while (positions.size > MAX_ENTRIES) {
    const oldest = positions.keys().next().value;
    if (oldest === undefined) break;
    positions.delete(oldest);
  }
}

export function useScrollRestoration(regionId: string): void {
  useEffect(() => {
    const region = document.getElementById(regionId);
    if (!region) return undefined;

    let pending = 0;
    /** True while a restore is in flight; suppresses recording. */
    let restoring = false;

    /**
     * Records the CURRENT position under the CURRENT entry.
     *
     * The key is recomputed on every call, and that is the whole correctness
     * argument. Caching it at mount looks harmless and is not: a forward
     * navigation is a `pushState`, which fires no event this hook listens to, so
     * a cached key would still name the entry the user came FROM. The first
     * version did exactly that and filed every position under the wrong entry —
     * measured as "left at 1500, returned to 0", which looks identical to having
     * no restoration at all.
     */
    const remember = () => {
      if (restoring) return;
      record(entryKey(), region.scrollTop);
    };

    const onScroll = () => {
      // Coalesced: a scroll gesture fires this many times a second.
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = 0;
        remember();
      }, 150);
    };

    const onPopState = () => {
      // The outgoing position was already recorded by the scroll listener —
      // which matters, because `popstate` fires AFTER the entry has changed and
      // could not record it correctly even if it tried.
      const saved = positions.get(entryKey());
      if (typeof saved !== 'number' || saved <= 0) return;

      // Restoring has to outlive the render, and this is the part that was wrong
      // twice.
      //
      // At `popstate` the router has changed the URL but has NOT yet painted the
      // previous screen's content: measured, `main.scrollHeight` is still the
      // short page's. Writing `scrollTop = 1500` there is clamped to the current
      // height and silently becomes 0 — and a frame-counted retry (12 frames,
      // ~200ms) expires before the rows arrive, which is how the second attempt
      // failed while looking correct.
      //
      // So the window is TIME-bounded rather than frame-bounded and stops on the
      // first value that sticks. `restoring` suppresses recording meanwhile, or
      // the interim zeroes would overwrite the very position being restored and
      // the next Back would find nothing.
      restoring = true;
      const deadline = Date.now() + 2000;

      const apply = () => {
        region.scrollTop = saved;
        const settled = Math.abs(region.scrollTop - saved) < 2;
        if (settled || Date.now() > deadline) {
          // One frame of grace before recording resumes, so the write that just
          // succeeded is not immediately re-recorded as a user scroll.
          requestAnimationFrame(() => {
            restoring = false;
          });
          return;
        }
        requestAnimationFrame(apply);
      };
      requestAnimationFrame(apply);
    };

    region.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPopState);

    return () => {
      if (pending) clearTimeout(pending);
      remember();
      region.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPopState);
    };
  }, [regionId]);
}
