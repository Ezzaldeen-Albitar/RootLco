'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { translate } from '@/i18n/get-messages';
import { useBranchTarget } from '../use-branch-target';
import {
  useUnsavedWork,
  useWorkingContext,
  useWorkingContextMessages,
} from '../WorkingContextProvider';
import { RequiresConcreteBranch } from './WorkingBranchField';
import { useRouteScope } from './RouteScopeProvider';

const noSubscription = () => () => undefined;

/**
 * A screen that needs one branch is not drawn until one is named.
 *
 * ## Why in the page body, once, rather than on each screen
 *
 * The PR #467 review found the job picker on the invoice desk listing the work
 * orders of EVERY branch under "All my branches", on a route whose header said
 * the screen works in one branch. A rule enforced screen by screen is only as
 * good as the screen that forgot it. `config/route-branch-scope.ts` already says
 * which routes need one branch, and every workspace page puts its screen in
 * `PageBody` — which wraps it in this gate. The page's title stays above it, and
 * a page that refuses the operator (`PermissionDeniedState` and the other
 * refusal states) is never wrapped: a refusal is said before any branch ask.
 *
 * ## What it draws
 *
 *   - on a `concrete` route, while "All my branches" is selected or nothing is
 *     chosen yet, the ask and the authorized branches by name instead of the
 *     screen. Nothing below mounts, so no list is read and no write can start.
 *     Choosing goes through the working context's own guarded `select`;
 *   - on a `union` or `none` route, and in every other state (one branch named,
 *     no branch assigned, the directory unreadable), the screen, which says
 *     those last two in its own words;
 *   - on the SERVER and in the hydration render, a concrete route with several
 *     branches draws neither the screen nor the ask: the remembered branch lives
 *     in browser storage, so which of the two is right is not known until the
 *     browser takes over. An empty, busy placeholder is drawn instead, identical
 *     on both sides, so hydration matches and no ask flashes at an operator whose
 *     branch is remembered.
 *
 * ## A screen holding unsaved work is never unmounted without an answer
 *
 * The branch a screen was working in can stop being published while it is open
 * — a grant withdrawn, then a refresh — and the working context then holds no
 * branch at all. Unmounting the screen at that moment would throw away a
 * half-filled form behind `useUnsavedGuard`'s back (PR #467 review). So when the
 * gate would close over a screen that holds unsaved work, it HOLDS instead: the
 * screen stays mounted, untouched and inert, under a notice offering the named
 * branches and a way to discard. Choosing a branch goes through the guarded
 * `select`, which asks before the work is lost; discarding resets the screen's
 * work through its own `onDiscard` and only then shows the ask.
 */
export function ConcreteRouteGate({ children }: { readonly children: ReactNode }) {
  // The route's posture, from the shell (`RouteScopeProvider`); null outside it.
  const scope = useRouteScope();
  const context = useWorkingContext();
  const messages = useWorkingContextMessages();
  const state = useBranchTarget();
  const unsaved = useUnsavedWork();
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );

  const applies = context.present && messages !== null && scope === 'concrete';
  const undecided = state.kind === 'all' || state.kind === 'unchosen';
  const closing = applies && inBrowser && undecided;

  // Whether the screen was on view before this render, and whether it is held.
  const [previous, setPrevious] = useState<'screen' | 'closed'>(() =>
    closing ? 'closed' : 'screen'
  );
  const [held, setHeld] = useState(false);
  if (closing && previous === 'screen') {
    setPrevious('closed');
    if (unsaved.any()) setHeld(true);
  } else if (!closing && previous === 'closed') {
    setPrevious('screen');
    if (held) setHeld(false);
  }

  /*
   * The screen always sits at the same place in the tree — second in a
   * fragment whose first slot is the held notice or nothing, in a layout-neutral
   * wrapper — so holding it (below) never remounts it and never loses what was
   * typed. While held it is inert, so nothing can be sent from it.
   */
  const screenIn = (notice: ReactNode) => (
    <>
      {notice}
      <div
        className="contents"
        inert={notice !== null}
        data-testid={notice !== null ? 'concrete-route-gate-held-screen' : undefined}
      >
        {children}
      </div>
    </>
  );

  if (!applies) return screenIn(null);

  if (!inBrowser) {
    const unknown =
      context.status === 'ready' && context.branches.length > 1 && state.kind !== 'ready';
    if (!unknown) return screenIn(null);
    return <div data-testid="concrete-route-gate-pending" aria-busy="true" />;
  }

  if (!undecided) return screenIn(null);

  const ask = (
    <RequiresConcreteBranch
      messages={messages}
      state={state}
      chooser
      testId="concrete-route-gate-prompt"
    />
  );

  if (!held) {
    return (
      <div className="flex max-w-md flex-col gap-3" data-testid="concrete-route-gate">
        {ask}
      </div>
    );
  }

  return screenIn(
    <section
      className="mb-4 flex max-w-md flex-col gap-3 rounded-md border border-border bg-surface p-4"
      data-testid="concrete-route-gate-held"
    >
      {ask}
      <p className="text-supporting text-text-secondary">
        {translate(messages, 'workingContext.held.description')}
      </p>
      <div>
        <button
          type="button"
          onClick={() => {
            unsaved.discard();
            setHeld(false);
          }}
          className="rounded-md border border-border bg-surface px-4 py-2 text-button text-text-secondary hover:bg-surface-subtle"
        >
          {translate(messages, 'workingContext.held.discard')}
        </button>
      </div>
    </section>
  );
}
