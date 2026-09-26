import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchScopeQuery,
  type BranchScope,
  type CursorPage,
} from '@/lib/api/read-operation';
import type { WorkOrderListCriteria, WorkOrderListEntry } from './work-orders-contract';

/**
 * The one read the work-order board issues (P1-29, `W1`) — `wo.work-order-list`
 * — SERVER ONLY.
 *
 * The body `listWorkOrders` ran, moved here so the Server Action and the GET
 * route at `/reads/work-orders` share one implementation (P1-32-PRE-OD-READ).
 * No directive: nothing here is a browser-callable endpoint, and
 * `authorizedClient()` reads the `httpOnly` cookie through `next/headers`,
 * which a client bundle does not have. `tests/cancellable-reads.test.ts` fails
 * when a client module reaches this file. `signal` reaches the API call, so a
 * caller that gives up stops the request.
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application and it lives in `src/lib/api` because
 * `check-api-boundary.mjs` says so. This file turns operations into view states
 * and nothing else.
 *
 * ## The company is a selector, the branch is an optional target
 *
 * `wo.work-order-list` declares `scope: 'branch'`, and a NAMED branch is still
 * the authorization target: the pre-handler check reads the pair out of the
 * query and decides against the branch actually being read. What changed under
 * the Owner directive (`P1-32-PRE-OD-UX`) is that omitting the branch is now a
 * REQUEST rather than a gap — it asks for every branch of the named company the
 * caller may read, and the route resolves that set inside the transaction by
 * putting each candidate branch to this operation's own permission code and
 * refusing a caller that holds none. So the omission cannot widen what this
 * operator is entitled to see.
 *
 * Both shapes travel through `branchScopeQuery`, which demands the company and
 * refuses a blank branch: an omitted branch is the documented request, a blank
 * one is a malformed reference answered 422 far from the mistake.
 *
 * The board therefore reads on mount. There is nothing left to validate before
 * asking — the branch is the working context's own named selection — and the
 * first request is bounded rather than unbounded.
 *
 * ## A denial is not an empty page
 *
 * `STATUS_BY_KIND` maps a 403 to `denied` and the table renders that as a
 * refusal. Collapsing it to zero rows would tell an operator "there is nothing
 * here" when the truth is "you may not see it" — the failure mode
 * `read-operation.ts` exists to prevent, and one this board must not reintroduce.
 */
const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * A board flag on the wire, or nothing at all.
 *
 * Three states, not two: asked ON, asked OFF, and never asked. `undefined`
 * leaves the parameter out — which is the only way to say "no opinion" to a
 * `.strict()` schema — while `false` is sent as the literal `'false'`, because
 * the route reads the two words and a caller that meant to turn a flag off must
 * be able to say so.
 */
function flag(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'true' : 'false';
}

export async function readWorkOrderList(
  scope: BranchScope,
  criteria: WorkOrderListCriteria,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<WorkOrderListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/work-orders' +
    branchScopeQuery(scope, {
      state: criteria.state,
      // Never both: the route refuses the pair rather than intersecting it, and
      // the screen clears one when the other is chosen.
      stateGroup: criteria.stateGroup,
      kind: criteria.kind,
      openedFrom: criteria.openedFrom,
      openedTo: criteria.openedTo,
      completedFrom: criteria.completedFrom,
      completedTo: criteria.completedTo,
      customerId: criteria.customerId,
      q: criteria.q,
      // Written as the literal the route's `z.enum(['true','false'])` takes.
      // `String(false)` is `'false'`, which the route reads as OFF; leaving the
      // flag out entirely is what "did not ask" means, and `branchScopeQuery`
      // drops an undefined value rather than serialising it.
      assignedToMe: flag(criteria.assignedToMe),
      awaitingParts: flag(criteria.awaitingParts),
      awaitingApproval: flag(criteria.awaitingApproval),
      awaitingQuality: flag(criteria.awaitingQuality),
      readyForDelivery: flag(criteria.readyForDelivery),
      cursor,
      limit: request.pageSize,
    });

  // `retries: 0` for the same reason the reception queue takes none: this is an
  // `expensive-read` policy on the backend, and a board an operator can re-run
  // by pressing the button again should not be re-run for them under a rate
  // limit they cannot see.
  const result = await client.get<CursorPage<WorkOrderListEntry>>(path, {
    retries: 0,
    ...(signal ? { signal } : {}),
  });
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
