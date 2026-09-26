'use client';

import { useId, useMemo } from 'react';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import {
  ALL_BRANCHES,
  type WorkingContextBranch,
  type WorkingContextCompany,
  type WorkingContextStatus,
} from '../working-context-contract';

/**
 * The working-branch control, drawn on Material UI — ADR-022 PR1.
 *
 * PRESENTATIONAL. It decides nothing about which branch is in force: the
 * working-context provider does, and `WorkingContextControl` hands this the
 * provider's answer and its one guarded way to change it (`onSelect`, which is
 * the provider's `select`). So every rule the header kept is still kept where
 * it was decided:
 *
 *   - **one branch** — a sentence naming the branch and its company, never a
 *     control with one option;
 *   - **several** — ONE labelled selector, grouped by company, offering "All my
 *     branches" as a reading posture where there is more than one branch
 *     (`offerAllBranches`; the provider's rule). A screen that must address one
 *     branch refuses "all" itself and says so (`useBranchTarget`), exactly as
 *     before;
 *   - **nothing chosen yet** — the selector shows the ask, and the ask is
 *     ANNOUNCED (`role="status"`), because it is the first action of a session;
 *   - **not readable** — a sentence and a retry, never an empty control;
 *   - **a switch with unsaved work** asks first — not here, but in the provider,
 *     because `onSelect` IS the guarded path; the question (Material's
 *     `ConfirmDialog`) and the notice for another tab's change live there.
 *
 * The selector is Material's NATIVE select: a real `<select>` with `<optgroup>`
 * headings, the platform's own picker on a phone and its own keyboard model.
 * Material's menu select would render a button and a listbox that have to
 * re-earn all three.
 */
export interface BranchSelectorProps {
  readonly messages: Messages;
  readonly status: WorkingContextStatus;
  readonly companies: readonly WorkingContextCompany[];
  readonly branches: readonly WorkingContextBranch[];
  /** `''` when nothing is chosen, `ALL_BRANCHES`, or a branch id. */
  readonly value: string;
  /** The guarded switch. Never called with `''`. */
  readonly onSelect: (next: string) => void;
  /** Re-reads the branch list. Offered only when it could not be read. */
  readonly onRetry: () => void;
  /** Whether "All my branches" is a choice here. */
  readonly offerAllBranches: boolean;
}

export function BranchSelector({
  messages,
  status,
  companies,
  branches,
  value,
  onSelect,
  onRetry,
  offerAllBranches,
}: BranchSelectorProps) {
  const base = useId();
  const selectId = `${base}-select`;

  const grouped = useMemo(() => {
    const byCompany = new Map<string, WorkingContextBranch[]>();
    for (const branch of branches) {
      const list = byCompany.get(branch.companyId);
      if (list === undefined) byCompany.set(branch.companyId, [branch]);
      else list.push(branch);
    }
    return Array.from(byCompany.entries()).map(([companyId, list]) => ({
      companyId,
      name: companies.find((company) => company.id === companyId)?.name ?? null,
      branches: list,
    }));
  }, [branches, companies]);

  if (status === 'unavailable') {
    return (
      <div
        data-testid="working-context-unavailable"
        className="flex items-center gap-2 text-supporting text-text-secondary"
      >
        <span>{translate(messages, 'workingContext.unavailable')}</span>
        <Button variant="text" size="small" onClick={onRetry}>
          {translate(messages, 'workingContext.retry')}
        </Button>
      </div>
    );
  }

  if (status === 'none') {
    return (
      <Typography
        component="span"
        variant="body2"
        noWrap
        data-testid="working-context-none"
        className="text-text-secondary"
      >
        {translate(messages, 'workingContext.noBranch')}
      </Typography>
    );
  }

  const single = branches.length === 1 ? branches[0] : undefined;
  if (single !== undefined) {
    const company = companies.find((entry) => entry.id === single.companyId) ?? null;
    return (
      <Typography
        component="span"
        variant="body2"
        noWrap
        data-testid="working-context-single"
        className="text-text-primary"
      >
        {/*
          A middle dot rather than a dash or a slash: it reads as a separator in
          both scripts and is not mistaken for a range or a path. The branch
          comes first because it is the narrower fact.
        */}
        {company === null ? single.name : `${single.name} · ${company.name}`}
      </Typography>
    );
  }

  const unchosen = value === '';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <FormControl size="small" className="min-w-0 max-w-56">
        <label htmlFor={selectId} className="sr-only">
          {translate(messages, 'workingContext.label')}
        </label>
        <Select
          native
          value={value}
          onChange={(event) => {
            const next = String(event.target.value);
            if (next.length === 0) return;
            onSelect(next);
          }}
          inputProps={{ id: selectId, 'data-testid': 'working-context-select' }}
        >
          {unchosen ? (
            <option value="">{translate(messages, 'workingContext.choose')}</option>
          ) : null}
          {offerAllBranches ? (
            <option value={ALL_BRANCHES}>
              {translate(messages, 'workingContext.allBranches')}
            </option>
          ) : null}
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
        </Select>
      </FormControl>
      {/*
        Announced, not merely shown: `role="status"` puts the ask in the
        accessibility tree the moment it appears.
      */}
      {unchosen ? (
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
