import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchScopeQuery,
  type BranchScope,
  type ReadState,
} from '@/lib/api/read-operation';
import type { DashboardSummary, DashboardSummaryCriteria } from './overview-contract';

/**
 * The one read the operations overview issues (`ovw.dashboard-summary-read`)
 * — SERVER ONLY.
 *
 * The body the retired `readDashboardSummary` action ran, now served only by
 * the GET route at `/reads/dashboard-summary` — one implementation
 * (P1-32-PRE-OD-READ). No directive: nothing here is a browser-callable
 * endpoint, and `authorizedClient()` reads the `httpOnly` cookie through
 * `next/headers`, which a client bundle does not have.
 * `tests/cancellable-reads.test.ts` fails when a client module reaches this
 * file. It maps the answer exactly as `readOperation` does, and adds only the
 * signal, which reaches the API call so a caller that gives up stops it.
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
export async function readDashboardSummaryState(
  scope: BranchScope,
  criteria: DashboardSummaryCriteria,
  signal?: AbortSignal
): Promise<ReadState<DashboardSummary>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };

  const path =
    '/api/v1/dashboard/summary' +
    branchScopeQuery(scope, {
      period: criteria.period,
      from: criteria.from,
      to: criteria.to,
    });
  // The call `readOperation` makes — default retries — with the signal added
  // only when there is one, so a call without a signal is that call exactly.
  const result = signal
    ? await client.get<DashboardSummary>(path, { signal })
    : await client.get<DashboardSummary>(path);
  if (result.ok) {
    return { status: 'ok', data: result.data, correlationId: result.correlationId };
  }
  return { status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
}
