'use server';

import {
  branchScopeQuery,
  readOperation,
  type BranchScope,
  type ReadState,
} from '@/lib/api/read-operation';
import type { DashboardSummary, DashboardSummaryCriteria } from './overview-contract';

/**
 * The one read the operations overview issues (`ovw.dashboard-summary-read`).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application and it lives in `src/lib/api` because
 * `check-api-boundary.mjs` says so. `readOperation` is that door; this file
 * builds a path and nothing else.
 *
 * ## The branch is optional and its absence is a REQUEST
 *
 * Naming a branch makes the pair the authorization target and the figures are
 * that branch's. Omitting it asks for the company, and the service resolves
 * which branches that means by putting each one to the permission check — so the
 * omission cannot widen what this caller is entitled to. Both shapes go through
 * `branchScopeQuery` for the same reason the two boards do.
 *
 * ## Why this returns a `ReadState` and not a page
 *
 * The operation is not paginated and publishes no cursor: it answers one object
 * whose every section carries its own status. A refusal of the WHOLE operation
 * (the caller lacks `wo.work_order.read`) is `denied` here; a refusal of one
 * SECTION arrives inside a 200 as `unauthorized`, and the two are different
 * facts that the screen renders differently.
 */
export async function readDashboardSummary(
  scope: BranchScope,
  criteria: DashboardSummaryCriteria
): Promise<ReadState<DashboardSummary>> {
  return readOperation<DashboardSummary>(
    '/api/v1/dashboard/summary' +
      branchScopeQuery(scope, {
        period: criteria.period,
        from: criteria.from,
        to: criteria.to,
      })
  );
}
