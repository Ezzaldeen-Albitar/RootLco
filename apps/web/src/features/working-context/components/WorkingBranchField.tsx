'use client';

import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import {
  branchBlockMessageKey,
  useBranchTarget,
  type BranchTargetState,
} from '../use-branch-target';
import { useWorkingContext } from '../WorkingContextProvider';

/**
 * The branch this screen is addressed to, stated rather than asked.
 *
 * ## What it replaces, and why the replacement is read-only
 *
 * Every branch-addressed screen used to carry its own company/branch pair: a
 * select over raw references, or — for an operator whose grant is not narrowed,
 * whose session therefore resolves to EMPTY lists — two free-text boxes asking
 * them to type a reference. Both were asking the operator to supply a fact the
 * platform knows, in a form they have to look up somewhere else, once per
 * screen, with no name attached to check it against.
 *
 * There is now exactly one place that answer can be changed, and it is the
 * header. A second editable control here would be a second authority for the
 * same fact, and the two would disagree the moment one of them was set.
 *
 * ## The pair still travels
 *
 * `branchTargetQuery` is untouched and remains the transport. What has changed
 * is where the pair comes from: a named selection the server published to this
 * operator, rather than a string they typed. Scope is still resolved
 * server-side on every request; this is a resource selector, and the server
 * re-authorizes it exactly as before.
 */
export function WorkingBranchField({
  messages,
  label,
  testId = 'working-branch-field',
}: {
  readonly messages: Messages;
  /** Defaults to the header control's own label, so the two read as one thing. */
  readonly label?: string | undefined;
  readonly testId?: string;
}) {
  const context = useWorkingContext();
  const state = useBranchTarget();

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="text-label font-medium text-text-primary">
        {label ?? translate(messages, 'workingContext.label')}
      </span>
      {state.kind === 'ready' ? (
        <>
          <p className="text-body text-text-primary">
            {(() => {
              const name = context.branchName(state.target.branchId);
              const company = context.companyOf(state.target.branchId);
              if (name === null) return state.target.branchId;
              return company === null ? name : `${name} · ${company.name}`;
            })()}
          </p>
          <p className="text-supporting text-text-muted">
            {translate(messages, 'workingContext.changeInHeader')}
          </p>
        </>
      ) : (
        <RequiresConcreteBranch messages={messages} state={state} />
      )}
    </div>
  );
}

/**
 * The one sentence a screen shows when it cannot be addressed to a branch.
 *
 * Shared rather than written per screen, because the four reasons are the same
 * four everywhere and a screen that invents its own wording for "choose a
 * branch" teaches the operator that the two screens mean different things.
 *
 * `role="status"` because it appears in response to something the operator did
 * — choosing "all my branches", or arriving before choosing at all — and an
 * unannounced sentence beside a disabled button explains nothing to anyone not
 * looking at it.
 */
export function RequiresConcreteBranch({
  messages,
  state,
  testId = 'requires-concrete-branch',
}: {
  readonly messages: Messages;
  /** Defaults to the screen's own branch state. Passed in only to save a lookup. */
  readonly state?: BranchTargetState | undefined;
  /**
   * A form may say this twice — once where the branch is named, and again
   * beside a submit the operator has just found disabled at the bottom of a
   * long form. The second one is not duplication, it is the answer arriving
   * where the question was asked; naming them apart is what lets a test say
   * which it means.
   */
  readonly testId?: string;
}) {
  const own = useBranchTarget();
  const resolved = state ?? own;
  const key = branchBlockMessageKey(resolved);
  if (key === null) return null;
  return (
    <p
      role="status"
      data-testid={testId}
      className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
    >
      {translateDynamic(messages, key)}
    </p>
  );
}
