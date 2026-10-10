'use client';

import { useEffect } from 'react';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The company/branch pair every appointment surface must name (P1-28 Wave C,
 * re-sourced from the working context).
 *
 * `GET /appointments` and `POST /appointments` both REQUIRE `companyId` and
 * `branchId` — a resource selector naming WHICH branch's calendar is read or
 * booked, carried as the authorization target (`P1-18-A-01`), never a scope
 * assertion. That has not changed, and `branchTargetQuery` is still the
 * transport.
 *
 * ## What the docblock here used to claim, and why it is no longer true
 *
 * It said: "The platform publishes no company or branch directory, so there are
 * no names to offer — only the references the operator's own session resolves
 * to." That was accurate when it was written and it is now false.
 * `GET /auth/working-context` publishes the named, active companies and
 * branches the caller is authorized for, and it states `unrestricted`
 * explicitly instead of encoding it as an empty list. The two consequences of
 * the old contract both disappear with it:
 *
 *   - the select over raw references, which asked an operator to recognise a
 *     branch by a string they could not read; and
 *   - the free-text box shown to an operator whose grant is NOT narrowed —
 *     precisely the person with the most reach — asking them to type one.
 *
 * ## Why this is now read-only
 *
 * The branch is chosen once, in the header, and every screen reads that choice.
 * An editable pair here would be a second authority for the same fact. The
 * props are unchanged so no caller had to move: the pair is still reported
 * upward through `onCompanyChange` / `onBranchChange`, so the surrounding
 * screen's submit, validation and request-building are untouched — what changed
 * is where the values come from.
 *
 * The session's `companyIds` and `branchIds` are gone from this component and
 * from every page that fed them to it. They were bare references with no names,
 * and an EMPTY pair of them meant unrestricted rather than none — the two facts
 * that produced the reference select and the free-text box this used to render.
 * Nothing should be passing them anywhere, so nothing accepts them.
 */

export function BranchTargetFields(props: {
  readonly messages: Messages;
  readonly companyId: string;
  readonly branchId: string;
  readonly onCompanyChange: (next: string) => void;
  readonly onBranchChange: (next: string) => void;
  readonly companyError?: string | undefined;
  readonly branchError?: string | undefined;
  /**
   * The caller's submission counter. Retained because every `<form action={…}>`
   * call site passes it and because removing a prop from a shared component is
   * a wider change than this one; nothing here remounts on it any more, since
   * there is no longer an entered value for a form reset to lose.
   */
  readonly attempt?: number;
}) {
  const { messages, companyId, branchId, onCompanyChange, onBranchChange } = props;
  const state = useBranchTarget();

  const selectedCompany = state.kind === 'ready' ? state.target.companyId : '';
  const selectedBranch = state.kind === 'ready' ? state.target.branchId : '';

  /*
   * The surrounding screen keeps its own copy of the pair — it validates it,
   * builds the request from it and reports field errors against it — so the
   * header's choice is pushed up rather than read sideways. Guarded by
   * equality, so this settles in one pass and never loops.
   */
  useEffect(() => {
    if (selectedCompany !== companyId) onCompanyChange(selectedCompany);
    if (selectedBranch !== branchId) onBranchChange(selectedBranch);
  }, [selectedCompany, selectedBranch, companyId, branchId, onCompanyChange, onBranchChange]);

  const error = props.branchError ?? props.companyError;

  return (
    <div className="sm:col-span-2">
      <WorkingBranchField
        messages={messages}
        label={translate(messages, 'workingContext.label')}
        testId="appointment-branch-target"
      />
      {error === undefined ? null : (
        // One message for the pair, because the pair is one decision now. A
        // complaint about either half names the same control.
        <p role="alert" className="mt-1 text-supporting text-error">
          {error}
        </p>
      )}
    </div>
  );
}
