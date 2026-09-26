'use client';

import { SelectField } from '@/components/forms/Field';
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
 * There is now exactly one authority for that answer: the working context,
 * set from the header. A second editable control holding its own value here
 * would be a second authority for the same fact, and the two would disagree the
 * moment one of them was set. The one exception is not a second authority:
 * while the screen needs a branch and has none ("All my branches", or nothing
 * chosen yet), the refusal below offers the named branches and writes the
 * choice straight into the working context through its guarded `select`.
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
  acceptsAllBranches = false,
}: {
  readonly messages: Messages;
  /** Defaults to the header control's own label, so the two read as one thing. */
  readonly label?: string | undefined;
  readonly testId?: string;
  /**
   * Whether this screen reads "All my branches" as a union the server enforces
   * (a `union` route in `config/route-branch-scope.ts`).
   *
   * Browser QA part 7, row 1b.4: the work-order board listed both branches
   * under "All my branches" while this field, beside the list, said "Choose one
   * branch in the header to continue". A board whose read answers for the whole
   * authorized set names that set here; a screen that must address one branch
   * leaves this off and asks, as before.
   */
  readonly acceptsAllBranches?: boolean;
}) {
  const context = useWorkingContext();
  const state = useBranchTarget();

  if (state.kind === 'all' && acceptsAllBranches) {
    const companyId = context.selection?.companyId ?? null;
    const company =
      companyId === null
        ? null
        : (context.companies.find((entry) => entry.id === companyId) ?? null);
    const everything = translate(messages, 'workingContext.allBranches');
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        <span className="text-label font-medium text-text-primary">
          {label ?? translate(messages, 'workingContext.label')}
        </span>
        <p className="text-body text-text-primary" data-testid={`${testId}-all`}>
          {company === null ? everything : `${everything} · ${company.name}`}
        </p>
        <p className="text-supporting text-text-muted">
          {translate(messages, 'workingContext.changeInHeader')}
        </p>
      </div>
    );
  }

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
        // The place the branch is named is also the place it can be chosen
        // when the screen needs one: a named chooser, never a silent default.
        <RequiresConcreteBranch messages={messages} state={state} chooser />
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
  fallbackKey,
  testId = 'requires-concrete-branch',
  chooser = false,
}: {
  readonly messages: Messages;
  /** Defaults to the screen's own branch state. Passed in only to save a lookup. */
  readonly state?: BranchTargetState | undefined;
  /**
   * What to say when the branch state is fine and there is still nothing to
   * choose from.
   *
   * A screen may be picking something other than a branch — the settings editor
   * and the approval limits both choose a COMPANY — and a caller whose own list
   * came back empty was rendering this and getting nothing at all: a labelled
   * control area with no control and no sentence, which reads as a broken
   * screen rather than as an empty list. The caller names what is missing,
   * because only the caller knows which list it was.
   */
  readonly fallbackKey?: string | undefined;
  /**
   * A form may say this twice — once where the branch is named, and again
   * beside a submit the operator has just found disabled at the bottom of a
   * long form. The second one is not duplication, it is the answer arriving
   * where the question was asked; naming them apart is what lets a test say
   * which it means.
   */
  readonly testId?: string;
  /**
   * Whether to offer the named branches right here, beside the sentence.
   *
   * On for the one place a screen names its branch (`WorkingBranchField`) and
   * off for the repeats beside a list or a submit, so a screen never carries two
   * choosers for one answer. The choice goes through the working context's own
   * guarded `select` — the same path the header uses, asking first when a
   * screen holds unsaved work — so there is still one authority for the branch,
   * reachable from where the question is asked. Shown only while "All my
   * branches" is selected or nothing is chosen yet; never pre-filled.
   */
  readonly chooser?: boolean;
}) {
  const own = useBranchTarget();
  const resolved = state ?? own;
  const key = branchBlockMessageKey(resolved) ?? fallbackKey ?? null;
  if (key === null) return null;
  const sentence = (
    <p
      role="status"
      data-testid={testId}
      className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
    >
      {translateDynamic(messages, key)}
    </p>
  );
  if (!chooser || (resolved.kind !== 'all' && resolved.kind !== 'unchosen')) return sentence;
  return (
    <div className="flex flex-col gap-2">
      {sentence}
      <ConcreteBranchChooser messages={messages} />
    </div>
  );
}

/**
 * The authorized branches by name, grouped by company, with nothing selected.
 *
 * A native select, like the header's, for the same reasons: keyboard and phone
 * pickers for free, and `optgroup` carrying the company to assistive technology.
 */
function ConcreteBranchChooser({ messages }: { readonly messages: Messages }) {
  const context = useWorkingContext();
  if (context.branches.length < 2) return null;
  const byCompany = new Map<string, { value: string; label: string }[]>();
  for (const branch of context.branches) {
    const list = byCompany.get(branch.companyId);
    const option = { value: branch.id, label: branch.name };
    if (list === undefined) byCompany.set(branch.companyId, [option]);
    else list.push(option);
  }
  const groups = Array.from(byCompany.entries()).map(([companyId, options]) => ({
    label:
      context.companies.find((company) => company.id === companyId)?.name ??
      translate(messages, 'workingContext.otherCompany'),
    options,
  }));
  return (
    <SelectField
      label={translate(messages, 'workingContext.chooseHere')}
      data-testid="concrete-branch-chooser"
      value=""
      onChange={(event) => {
        const next = event.target.value;
        if (next.length > 0) context.select(next);
      }}
      groups={groups}
      placeholder={translate(messages, 'workingContext.choose')}
    />
  );
}
