'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { UnsavedWork } from '../WorkingContextProvider';

/**
 * Asks before the operator leaves a page that holds unsaved work — the ONE
 * place that does, for every screen that declares its work with
 * `useUnsavedGuard`.
 *
 * ## Why here, and why once
 *
 * Browser QA on the Organisation settings page (DEF-S2b) typed a new time zone,
 * clicked "Customers" in the side menu, and landed on the customer list with the
 * draft gone and no question asked. The only guard then was the branch switch's,
 * and that page has no branch control, so nothing could ever ask. Every screen
 * already TELLS the shell when it holds work (`useUnsavedGuard`); what was
 * missing was a listener on the ways a page is actually left. Writing it per
 * screen would be forty copies of the same event handling, each one a chance to
 * forget a case, so it is written once and mounted by the working-context
 * provider for the whole workspace.
 *
 * ## The three ways out, and what each one does
 *
 *   - **A link or a menu entry inside the application.** A left click with no
 *     modifier on a same-origin link that leads to another page is stopped in
 *     the CAPTURE phase, before the router's own handler sees it, and the
 *     question is asked. A click with Ctrl, Cmd, Shift or Alt, a middle click, a
 *     link that opens elsewhere (`target`), a download, a link to another site
 *     and a link to a place on the same page are all left alone: none of them
 *     takes this page away (another site unloads the page, which the browser's
 *     own prompt below covers).
 *   - **Back and forward.** The browser has already moved the address when it
 *     says so (`popstate`), so the router is stopped from following it, the
 *     question is asked, and "Stay" puts this page's address back. "Leave" lets
 *     the router follow the address the browser moved to.
 *   - **Reload, closing the tab, typing an address.** Only the browser may ask
 *     here, in its own words; a `beforeunload` listener is registered exactly
 *     while something is unsaved and removed the moment nothing is.
 *
 * With nothing unsaved nothing is intercepted: the listeners look at the
 * registry at the moment of the click, so a page is never slowed or questioned
 * for work it does not hold.
 *
 * ## "Leave" is a real discard
 *
 * The question says the changes will be lost, so they are: every screen whose
 * work is unsaved at the moment of the answer has its `onDiscard` called before
 * the navigation starts, and the page it leaves is unmounted by the navigation
 * itself. Nothing is sent; nothing is half-saved.
 *
 * ## "Stay" returns the operator to the work
 *
 * The cursor goes back to the control the operator was last in (the dialog
 * would otherwise hand it to the link that was clicked), the typed values are
 * untouched, and the address is this page's again.
 *
 * ## What it does not see
 *
 * A navigation the application makes on its own — `router.push` after a
 * successful save, a row opened by a click handler — does not pass through a
 * link and is not asked about. The saves are exactly the case that must not
 * ask; every screen lowers its declaration when its work is stored.
 */
export function UnsavedNavigationGuard({
  work,
  messages,
}: {
  readonly work: UnsavedWork;
  readonly messages: Messages;
}) {
  const dirty = useSyncExternalStore(work.subscribe, work.any, notDirtyOnServer);
  const [pending, setPending] = useState<PendingLeave | null>(null);

  /** The question open now, for the listeners, which outlive a render. */
  const pendingNow = useRef<PendingLeave | null>(null);
  /** Set while this guard itself replays a navigation it let through. */
  const replaying = useRef(false);
  /** The address and history state of the page holding the work. */
  const here = useRef<HistoryEntry | null>(null);
  /** The control the operator was last in, for "Stay". */
  const lastControl = useRef<HTMLElement | null>(null);
  /** Where the cursor goes once the dialog has closed on "Stay". */
  const focusBack = useRef<HTMLElement | null>(null);

  /*
   * Where "Stay" returns to: the page the work is typed on. Noted when the work
   * BECOMES unsaved and again on every entry and every control the operator
   * moves to, so an address the application changed by itself in between (a
   * filter written into the query) is the one restored, not an older one.
   */
  useEffect(() => {
    if (dirty) here.current = currentEntry();
  }, [dirty]);

  // Reload and close: the browser's own question, only while there is work.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && isWorkControl(target)) lastControl.current = target;
      if (pendingNow.current === null) here.current = currentEntry();
    };
    const onInput = () => {
      if (pendingNow.current === null) here.current = currentEntry();
    };

    const onClick = (event: MouseEvent) => {
      if (replaying.current || !work.any()) return;
      const anchor = leavingLink(event);
      if (anchor === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      here.current = currentEntry();
      setPending({ kind: 'link', anchor, href: anchor.href });
    };

    const onPopState = (event: PopStateEvent) => {
      if (replaying.current) return;
      if (!work.any()) {
        here.current = currentEntry();
        return;
      }
      // The router must not follow the address until the operator answers.
      event.stopImmediatePropagation();
      setPending({ kind: 'history', state: event.state as unknown });
    };

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('click', onClick, true);
    // Capture on the window runs before the router's own listener there.
    window.addEventListener('popstate', onPopState, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState, true);
    };
  }, [work]);

  // After the dialog has gone (and handed focus back to the link), the cursor
  // goes to the control the operator was working in.
  useEffect(() => {
    pendingNow.current = pending;
    if (pending !== null) return;
    const target = focusBack.current;
    focusBack.current = null;
    if (target !== null && target.isConnected) target.focus();
  }, [pending]);

  const stay = useCallback(() => {
    const waiting = pending;
    setPending(null);
    if (waiting?.kind === 'history') {
      const entry = here.current;
      if (entry !== null) window.history.pushState(entry.state, '', entry.href);
    }
    focusBack.current = lastControl.current;
  }, [pending]);

  const leave = useCallback(() => {
    const waiting = pending;
    setPending(null);
    if (waiting === null) return;
    // The answer was "lose them": every screen still holding work throws it away
    // before the page is left, so nothing half-typed survives to be sent.
    work.discard();
    here.current = null;
    replaying.current = true;
    try {
      if (waiting.kind === 'link') {
        if (waiting.anchor.isConnected) waiting.anchor.click();
        else window.location.assign(waiting.href);
      } else {
        // The browser already holds the new address; the router follows it now.
        window.dispatchEvent(new PopStateEvent('popstate', { state: waiting.state }));
      }
    } finally {
      replaying.current = false;
    }
  }, [pending, work]);

  return (
    <ConfirmDialog
      open={pending !== null}
      onCancel={stay}
      onConfirm={leave}
      title={translate(messages, 'workingContext.leave.title')}
      description={translate(messages, 'workingContext.leave.description')}
      confirmLabel={translate(messages, 'workingContext.leave.confirm')}
      cancelLabel={translate(messages, 'workingContext.leave.stay')}
      messages={messages}
      destructive
      testId="unsaved-navigation-dialog"
    />
  );
}

type PendingLeave =
  | { readonly kind: 'link'; readonly anchor: HTMLAnchorElement; readonly href: string }
  | { readonly kind: 'history'; readonly state: unknown };

interface HistoryEntry {
  readonly href: string;
  readonly state: unknown;
}

const notDirtyOnServer = () => false;

function currentEntry(): HistoryEntry {
  return { href: window.location.href, state: window.history.state as unknown };
}

/** A control an operator types or chooses in — where "Stay" puts the cursor back. */
function isWorkControl(element: HTMLElement): boolean {
  if (element.closest('a[href]') !== null) return false;
  if (element.isContentEditable) return true;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element.getAttribute('role') === 'combobox'
  );
}

/**
 * The link this click would leave the page by, or `null` when the click does
 * not take this page away — see "The three ways out".
 */
function leavingLink(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const origin = event.target instanceof Element ? event.target : null;
  const anchor = origin?.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute('download')) return null;
  const target = anchor.getAttribute('target');
  if (target !== null && target !== '' && target !== '_self') return null;
  let destination: URL;
  try {
    destination = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (destination.origin !== window.location.origin) return null;
  if (
    destination.pathname === window.location.pathname &&
    destination.search === window.location.search
  ) {
    return null;
  }
  return anchor;
}
