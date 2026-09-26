'use server';

import type { BranchScope, ReadState } from '@/lib/api/read-operation';
import { readDashboardSummaryState } from './dashboard-summary-read.server';
import type { DashboardSummary, DashboardSummaryCriteria } from './overview-contract';

/**
 * The one read the operations overview issues (`ovw.dashboard-summary-read`).
 *
 * The body lives in `dashboard-summary-read.server.ts`, shared with the GET
 * route the overview and the work-order board's figure strip now read through
 * so the browser can cancel the read (P1-32-PRE-OD-READ). This Server Action
 * stays for any caller that still invokes it, and answers exactly what it
 * answered before.
 */
export async function readDashboardSummary(
  scope: BranchScope,
  criteria: DashboardSummaryCriteria
): Promise<ReadState<DashboardSummary>> {
  return readDashboardSummaryState(scope, criteria);
}
