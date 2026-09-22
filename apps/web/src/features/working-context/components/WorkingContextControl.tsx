'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { ALL_BRANCHES, type WorkingContextBranch } from '../working-context-contract';
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
 */
export function WorkingContextControl({ messages }: { readonly messages: Messages }) {
  const context = useWorkingContext();
  const router = useRouter();
  const labelId = useId();

  const grouped = useMemo(() => {
    const byCompany = new Map<string, WorkingContextBranch[]>();
    for (const branch of context.branches) {
      const list = byCompany.get(branch.companyId);
      if (list === undefined) byCompany.set(branch.companyId, [branch]);
      else list.push(branch);
    }
    return Array.from(byCompany.entries()).map(([companyId, branches]) => ({
      companyId,
      name: context.companies.find((company) => company.id === companyId)?.name ?? null,
      branches,
    }));
  }, [context.branches, context.companies]);

  if (context.status === 'unavailable') {
    return (
      <div
        data-testid="working-context-unavailable"
        className="flex items-center gap-2 text-supporting text-text-secondary"
      >
        <span>{translate(messages, 'workingContext.unavailable')}</span>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-md px-2 py-1 text-supporting font-medium text-primary underline transition-colors duration-fast ease-standard hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'workingContext.retry')}
        </button>
      </div>
    );
  }

  if (context.status === 'none') {
    return (
      <span
        data-testid="working-context-none"
        className="truncate text-supporting text-text-secondary"
      >
        {translate(messages, 'workingContext.noBranch')}
      </span>
    );
  }

  const single = context.branches.length === 1 ? context.branches[0] : undefined;
  if (single !== undefined) {
    const company = context.companyOf(single.id);
    return (
      <span data-testid="working-context-single" className="truncate text-supporting text-text-primary">
        {/*
          A middle dot rather than a dash or a slash: it reads as a separator in
          both scripts and is not mistaken for a range or a path. The branch
          comes first because that is the narrower fact and the one the operator
          is looking for.
        */}
        {company === null ? single.name : `${single.name} · ${company.name}`}
      </span>
    );
  }

  const value = context.selection === null ? '' : (context.selection.allBranches ? ALL_BRANCHES : context.selection.branchId);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label id={labelId} htmlFor={`${labelId}-select`} className="sr-only">
        {translate(messages, 'workingContext.label')}
      </label>
      <select
        id={`${labelId}-select`}
        data-testid="working-context-select"
        value={value}
        onChange={(event) => {
          if (event.target.value.length === 0) return;
          context.select(event.target.value);
        }}
        className="h-11 max-w-56 truncate rounded-md border border-border bg-surface px-2 text-supporting text-text-primary transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {context.selection === null ? (
          <option value="">{translate(messages, 'workingContext.choose')}</option>
        ) : null}
        <option value={ALL_BRANCHES}>{translate(messages, 'workingContext.allBranches')}</option>
        {grouped.map((group) => (
          <optgroup
            key={group.companyId}
            label={group.name ?? translate(messages, 'workingContext.otherCompany')}
          >
            {group.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {/*
        Announced, not merely shown. `role="status"` puts the ask in the
        accessibility tree the moment it appears, which matters because it is
        the first action of the session and everything else waits on it.
      */}
      {context.selection === null ? (
        <span
          role="status"
          aria-live="polite"
          data-testid="working-context-prompt"
          className="hidden truncate text-supporting text-text-secondary sm:inline"
        >
          {translate(messages, 'workingContext.prompt')}
        </span>
      ) : null}
    </div>
  );
}
