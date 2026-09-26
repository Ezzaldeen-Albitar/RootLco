'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { routeBranchScopeFor } from '@/config/route-branch-scope';
import type { Messages } from '@/i18n/get-messages';
import { useBranchTarget } from '../use-branch-target';
import { useWorkingContext } from '../WorkingContextProvider';
import { RequiresConcreteBranch } from './WorkingBranchField';

const noSubscription = () => () => undefined;

/**
 * A screen that needs one branch is not drawn until one is named.
 *
 * ## Why at the shell, once, rather than on each screen
 *
 * The PR #467 review found the job picker on the invoice desk listing the work
 * orders of EVERY branch under "All my branches", on a route whose header said
 * the screen works in one branch — and nothing on the desk stopped a start. A
 * rule enforced screen by screen is only as good as the screen that forgot it.
 * `config/route-branch-scope.ts` already says which routes need one branch, so
 * the rule is kept here, where every workspace route passes:
 *
 *   - on a `concrete` route, while "All my branches" is selected or nothing is
 *     chosen yet, the screen is replaced by the ask and the authorized branches
 *     by name. Nothing below mounts, so no list is read, no picker searches and
 *     no write can start. Choosing a branch goes through the working context's
 *     own guarded `select`, and the screen then mounts on that branch;
 *   - a `union` or `none` route, and every other state (one branch named, no
 *     branch assigned, the directory unreadable), renders the screen, which
 *     says those last two in its own words.
 *
 * Nothing is chosen on the operator's behalf. The server render and the first
 * browser render draw the screen as before — the remembered branch arrives only
 * once the browser has taken over, and asking for a branch in that one frame
 * would flash the ask at every operator on every load.
 */
export function ConcreteRouteGate({
  messages,
  children,
}: {
  readonly messages: Messages;
  readonly children: ReactNode;
}) {
  const scope = routeBranchScopeFor(usePathname() ?? '');
  const context = useWorkingContext();
  const state = useBranchTarget();
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );

  const gated =
    inBrowser &&
    context.present &&
    scope === 'concrete' &&
    (state.kind === 'all' || state.kind === 'unchosen');

  if (!gated) return <>{children}</>;
  return (
    <div className="px-6 py-6" data-testid="concrete-route-gate">
      <div className="flex max-w-md flex-col gap-3">
        <RequiresConcreteBranch
          messages={messages}
          state={state}
          chooser
          testId="concrete-route-gate-prompt"
        />
      </div>
    </div>
  );
}
