'use client';

import { useSyncExternalStore } from 'react';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { addDays, dayIn, isKnownZone } from '@/lib/branch-time';
import type { ReportScopeOptions, ReportScopeSelection } from '../reports-contract';

/**
 * The report selection the working context answers on arrival (route sweep B3,
 * Owner directive `P1-32-PRE-OD-UX`).
 *
 * ## What it answers
 *
 * The branch the operator is working in, and TODAY on that branch's own clock:
 * `from` is today and `to` the day after, because the period is half-open and
 * `to` is the first day excluded. A report and the operational overview then
 * read on arrival instead of opening on a blank "run" page, and the form below
 * them shows exactly the selection that was read, so the operator can widen the
 * period or pick another branch by name.
 *
 * ## What it refuses to answer
 *
 * - **"All my branches", or no branch chosen yet** — `oneBranch`. The report
 *   operation is branch-scoped and takes exactly one branch; the server
 *   enforces no union, so nothing is read and the screen says a report covers
 *   one branch at a time.
 * - **A working branch the report directory does not hold** — `none`. The
 *   report screens choose from `org.companies` and `org.branches`; a branch
 *   outside them would be a selection whose only outcome is a refusal.
 * - **No working context at all, or the server's render** — `none`. The day is
 *   the browser's reading of the branch's clock and the server's render must
 *   agree with the first browser render, so nothing is seeded until the browser
 *   has taken over.
 * - **A working branch whose zone is not a clock this browser knows** —
 *   `zoneUnknown`, with the pair and NO day (`P1-32-PRE-OD-REPA-03`). "Today"
 *   is a day on the branch's clock, and a zone name the browser cannot resolve
 *   (or none at all) is no clock: asking for its day threw, and taking the
 *   browser's or UTC's day instead would present another clock's day as the
 *   branch's (Owner decision D-17). So nothing is read on arrival. The screen
 *   seeds its form with the working branch and leaves the two days for the
 *   operator, and the form's own note says the branch's zone is not known.
 */
export type WorkingReportScope =
  | { readonly kind: 'ready'; readonly selection: ReportScopeSelection }
  | { readonly kind: 'oneBranch' }
  | {
      readonly kind: 'zoneUnknown';
      /** The working branch, for the form to start on. It carries no period. */
      readonly pair: Pick<ReportScopeSelection, 'companyId' | 'branchId'>;
    }
  | { readonly kind: 'none' };

const noSubscription = () => () => {};

export function useWorkingReportScope(options: ReportScopeOptions | null): WorkingReportScope {
  const context = useWorkingContext();
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );
  if (!inBrowser || !context.present || options === null) return { kind: 'none' };
  if (context.status !== 'ready') return { kind: 'none' };
  const selection = context.selection;
  if (selection === null || selection.allBranches) return { kind: 'oneBranch' };
  const branch = context.branches.find((entry) => entry.id === selection.branchId);
  const inDirectory =
    options.companies.some((company) => company.id === selection.companyId) &&
    options.branches.some(
      (entry) => entry.id === selection.branchId && entry.companyId === selection.companyId
    );
  if (branch === undefined || !inDirectory) return { kind: 'none' };
  if (!isKnownZone(branch.timezone)) {
    // No clock to read today on, and no other clock's day is taken in its place.
    return {
      kind: 'zoneUnknown',
      pair: { companyId: selection.companyId, branchId: selection.branchId },
    };
  }
  const today = dayIn(branch.timezone);
  return {
    kind: 'ready',
    selection: {
      companyId: selection.companyId,
      branchId: selection.branchId,
      from: today,
      to: addDays(today, 1),
    },
  };
}
