'use client';

import { useRouter } from 'next/navigation';
import type { Messages } from '@/i18n/get-messages';
import { BranchSelector } from '../mui/BranchSelector';
import { ALL_BRANCHES } from '../working-context-contract';
import { useWorkingContext } from '../WorkingContextProvider';

/**
 * Where I am working, in the header, on every screen.
 *
 * ## Why it belongs in the header and nowhere else
 *
 * It is the one control in the product whose answer changes what every other
 * screen is about. Put a copy on a screen and there are two authorities for the
 * same fact; put it in the sidebar and it disappears at the two widths where an
 * operator is most likely to be looking for it (the rail and the drawer). The
 * header is present, and identical, in every state — the same argument the
 * language switcher settled.
 *
 * It is rendered by the workspace layout only. The Platform Owner Console has
 * no branches and gets none of this.
 *
 * ## Four appearances, one for each honest state
 *
 *   - **One branch** — a sentence, not a control. Naming the branch answers
 *     "where am I" without asking a question that has one answer.
 *   - **Several** — a labelled select, grouped by company, with "All my
 *     branches" offered as a reading posture.
 *   - **Nothing chosen yet** — the select shows the ask, and the ask is
 *     ANNOUNCED. A visual prompt alone is invisible to a screen reader, and
 *     this is the first thing an operator must do.
 *   - **Not readable** — a short notice and a way to try again. Never an empty
 *     control, which would read as "you have no branches".
 *
 * The select is a native `<select>`: it is keyboard-accessible without any
 * code, it renders as the platform's own picker on a phone, and `optgroup`
 * carries the company grouping to assistive technology. A custom listbox would
 * have to re-earn all three.
 *
 * ## Drawn by `BranchSelector` (ADR-022)
 *
 * This component is the CONTAINER: it reads the working context and hands the
 * answer, the guarded switch and the retry to `mui/BranchSelector`, which draws
 * the four appearances on Material UI — still a native select, with the same
 * test ids, label and announcement.
 */
export function WorkingContextControl({ messages }: { readonly messages: Messages }) {
  const context = useWorkingContext();
  const router = useRouter();

  const value =
    context.selection === null
      ? ''
      : context.selection.allBranches
        ? ALL_BRANCHES
        : context.selection.branchId;

  return (
    <BranchSelector
      messages={messages}
      status={context.status}
      companies={context.companies}
      branches={context.branches}
      value={value}
      // The provider's `select` is the guarded path: with unsaved work on any
      // screen it asks before it switches (`useUnsavedGuard`).
      onSelect={context.select}
      onRetry={() => router.refresh()}
      // The provider's rule: "all" is a set, and a set needs more than one.
      offerAllBranches={context.branches.length > 1}
    />
  );
}
