'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  type BranchTarget,
  type CursorPage,
} from '@/lib/api/read-operation';
import type { WorkOrderListCriteria, WorkOrderListEntry } from './work-orders-contract';

/**
 * The one read the work-order board issues (P1-29, `W1`) — `wo.work-order-list`.
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application and it lives in `src/lib/api` because
 * `check-api-boundary.mjs` says so. This file turns one operation into one page
 * of table rows and nothing else.
 *
 * ## The branch pair is a TARGET, not a filter, and it is not optional
 *
 * `wo.work-order-list` declares `scope: 'branch'`, and a branch scope is inert
 * without a target: the pre-handler check reads the pair out of the query and,
 * with no pair, degrades to a scope-BLIND permission test. An operator holding
 * `wo.work_order.read` in one branch and any grant at all in another would then
 * see the second branch's board. So the pair travels through
 * `branchTargetQuery`, which refuses a half-built target rather than serialising
 * `undefined` into a URL.
 *
 * That is also why the screen mounts its results only once an operator has named
 * a branch: there is no request to make before then, and no default that would
 * be a guess about which board they meant.
 *
 * ## A denial is not an empty page
 *
 * `STATUS_BY_KIND` maps a 403 to `denied` and the table renders that as a
 * refusal. Collapsing it to zero rows would tell an operator "there is nothing
 * here" when the truth is "you may not see it" — the failure mode
 * `read-operation.ts` exists to prevent, and one this board must not reintroduce.
 */
const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function listWorkOrders(
  target: BranchTarget,
  criteria: WorkOrderListCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<WorkOrderListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/work-orders' +
    branchTargetQuery(target, {
      state: criteria.state,
      kind: criteria.kind,
      openedFrom: criteria.openedFrom,
      openedTo: criteria.openedTo,
      customerId: criteria.customerId,
      cursor,
      limit: request.pageSize,
    });

  // `retries: 0` for the same reason the reception queue takes none: this is an
  // `expensive-read` policy on the backend, and a board an operator can re-run
  // by pressing the button again should not be re-run for them under a rate
  // limit they cannot see.
  const result = await client.get<CursorPage<WorkOrderListEntry>>(path, { retries: 0 });
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
  };
}
