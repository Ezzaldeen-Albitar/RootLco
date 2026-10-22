'use client';

import type { BranchTarget } from '@/lib/api/read-operation';
import { useWorkingContext } from './WorkingContextProvider';

/**
 * The branch a screen is addressed to, or the reason it is not addressed yet.
 *
 * ## Why this is a state and not a nullable pair
 *
 * Four different situations produce "no target", and a screen that collapses
 * them into `null` can only render one sentence for all four — which is how an
 * operator with no branch assigned, an operator who has not chosen yet, an
 * operator reading every branch at once and an operator whose branch list
 * failed to load all ended up looking at the same blank form. Each one has a
 * different next step, and only one of them is a fault.
 *
 * `ready` is the only state a write may be addressed to. `all` is deliberately
 * NOT a target: `branchTargetQuery` demands both halves and the route schemas
 * name both as mandatory, so there is no honest way to send "every branch" —
 * and guessing one would write a record against a branch the operator never
 * named.
 */
export type BranchTargetState =
  /** One branch is selected. The pair may travel as the resource selector. */
  | { readonly kind: 'ready'; readonly target: BranchTarget }
  /** Reading every authorized branch. A write must narrow first. */
  | { readonly kind: 'all' }
  /** Several are authorized and none is chosen. The header asks. */
  | { readonly kind: 'unchosen' }
  /** No branch is authorized at all. Nothing here can be done. */
  | { readonly kind: 'none' }
  /** The branch list could not be read. The header offers a retry. */
  | { readonly kind: 'unavailable' };

export function useBranchTarget(): BranchTargetState {
  const context = useWorkingContext();
  if (context.status === 'unavailable') return { kind: 'unavailable' };
  if (context.status === 'none') return { kind: 'none' };
  const selection = context.selection;
  if (selection === null) return { kind: 'unchosen' };
  if (selection.allBranches) return { kind: 'all' };
  return {
    kind: 'ready',
    target: { companyId: selection.companyId, branchId: selection.branchId },
  };
}

/** The message a non-`ready` state should say, in the operator's own words. */
export function branchBlockMessageKey(state: BranchTargetState): string | null {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'all':
      return 'workingContext.needsOneBranch';
    case 'unchosen':
      return 'workingContext.chooseFirst';
    case 'none':
      return 'workingContext.noBranch';
    case 'unavailable':
      return 'workingContext.unavailable';
  }
}
