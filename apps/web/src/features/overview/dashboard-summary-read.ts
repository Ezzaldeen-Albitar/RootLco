import { z } from 'zod';
import { acceptReadState, browserRead, readFailure, readParam } from '@/lib/api/browser-read';
import type { BranchScope, ReadState } from '@/lib/api/read-operation';
import {
  DASHBOARD_PERIODS,
  type DashboardSummary,
  type DashboardSummaryCriteria,
} from './overview-contract';

/**
 * The overview figures as a CANCELLABLE read (P1-32-PRE-OD-READ).
 *
 * The same read `readDashboardSummary` performs, carried by the GET route at
 * `DASHBOARD_SUMMARY_ROUTE` instead of a Server Action so the browser can abort
 * it and so it does not queue behind another action on the page. This module is
 * the route's contract and the browser half; the server half is
 * `dashboard-summary-read.server.ts`.
 */

export const DASHBOARD_SUMMARY_ROUTE = '/reads/dashboard-summary';

export const dashboardSummaryQuery = z
  .object({
    companyId: readParam.id,
    branchId: readParam.id.optional(),
    period: z.enum(DASHBOARD_PERIODS),
    from: readParam.text.optional(),
    to: readParam.text.optional(),
  })
  .strict();

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuery>;

/** The arguments `readDashboardSummary` takes, as query parameters. */
export function dashboardSummaryParams(
  scope: BranchScope,
  criteria: DashboardSummaryCriteria
): Record<string, string | undefined | null> {
  return {
    companyId: scope.companyId,
    branchId: scope.branchId,
    period: criteria.period,
    from: criteria.from,
    to: criteria.to,
  };
}

/** The parsed query, as the arguments the server core takes. */
export function dashboardSummaryArgs(
  query: DashboardSummaryQuery
): [BranchScope, DashboardSummaryCriteria] {
  return [
    { companyId: query.companyId, branchId: query.branchId ?? null },
    {
      period: query.period,
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    },
  ];
}

/**
 * The overview figures, cancellable.
 *
 * Same arguments and same answer as `readDashboardSummary`, plus the signal:
 * aborting it rejects with an `AbortError` (`isCancelledRead`) and closes the
 * request.
 */
export function readDashboardSummaryCancellable(
  scope: BranchScope,
  criteria: DashboardSummaryCriteria,
  signal?: AbortSignal
): Promise<ReadState<DashboardSummary>> {
  return browserRead({
    route: DASHBOARD_SUMMARY_ROUTE,
    params: dashboardSummaryParams(scope, criteria),
    signal,
    accept: acceptReadState<DashboardSummary>,
    failure: readFailure<DashboardSummary>,
  });
}
