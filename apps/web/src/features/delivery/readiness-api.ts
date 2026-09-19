'use server';

import type { ServerPage } from '@/components/data-table/use-server-table';
import {
  branchTargetQuery,
  readOperation,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import {
  readinessPageSize,
  type DeliveryReadinessRow,
  type DeliveryReadinessScopeOptions,
} from './readiness-contract';

/** The directory endpoints enforce their own read permissions and tenant scope. */
export async function readDeliveryReadinessScopes(): Promise<
  ReadState<DeliveryReadinessScopeOptions>
> {
  const [companies, branches] = await Promise.all([
    readOperation<ItemsOnly<DeliveryReadinessScopeOptions['companies'][number]>>(
      '/api/v1/org/companies'
    ),
    readOperation<ItemsOnly<DeliveryReadinessScopeOptions['branches'][number]>>(
      '/api/v1/org/branches'
    ),
  ]);
  if (companies.status !== 'ok') return companies;
  if (branches.status !== 'ok') return branches;
  return {
    status: 'ok',
    data: { companies: companies.data.items, branches: branches.data.items },
    correlationId: null,
  };
}

/**
 * The one read the ready-for-delivery queue issues (P1-31, FE-001) —
 * `sal.delivery-readiness-list`.
 *
 * Nothing here fetches. `readOperation` calls `authorizedClient()`, the only
 * network owner in this application, and turns a transport outcome into a view
 * state — so a refusal reaches the table as a refusal and never as an empty
 * queue, which an operator reads as "nothing is ready".
 *
 * ## A separate module from `api.ts`, deliberately
 *
 * `api.ts` holds the reads that take a delivery identifier. This queue answers
 * the question that comes before one exists, on its own contract and its own
 * three permissions, and it is being written while that file is open in another
 * change. Two files that never touch is not a formatting preference here; it is
 * what lets both land.
 *
 * ## The branch pair is a TARGET, not a filter, and is not optional
 *
 * The operation is branch-scoped, and a branch scope is inert without a target:
 * with no pair the backend's check degrades to a scope-blind permission test,
 * and an operator holding a grant in a second branch would be shown that
 * branch's queue. So the pair travels through `branchTargetQuery`, which refuses
 * a half-built target rather than sending `undefined` in a query string — and
 * which also refuses to carry either half among the ordinary parameters, so a
 * scope cannot be smuggled in as a filter.
 *
 * That is also why the screen mounts its results only once an operator has named
 * a branch. There is no request to make before then, and no default that would
 * be a guess about which counter they meant.
 *
 * ## The page size is capped BEFORE the request, not after the refusal
 *
 * The route refuses a page larger than the queue's own ceiling instead of
 * clamping it, and the table offers a size above that ceiling. So the request is
 * built from `readinessPageSize`, and the screen says out loud when the size an
 * operator chose was more than the queue serves. Sending the larger number and
 * rendering the error would blame the operator for a limit only this side knew.
 *
 * ## No eligibility is asserted, and none could be
 *
 * There is no "ready only" parameter, here or on the route. Every candidate the
 * branch holds is returned with its checks and the server's verdict, and the
 * screen renders what it was told.
 */
export async function listDeliveryReadiness(input: {
  readonly companyId: string;
  readonly branchId: string;
  readonly cursor: string | null;
  readonly limit: number;
}): Promise<ServerPage<DeliveryReadinessRow>> {
  const path =
    '/api/v1/delivery-readiness' +
    branchTargetQuery(
      { companyId: input.companyId, branchId: input.branchId },
      { cursor: input.cursor, limit: readinessPageSize(input.limit) }
    );

  // A Server Action can be invoked without this screen. Re-read membership;
  // the backend additionally checks all three permissions in the selected branch.
  const scopes = await readDeliveryReadinessScopes();
  if (scopes.status !== 'ok') {
    return {
      status: scopes.status,
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: scopes.correlationId,
    };
  }
  if (
    !scopes.data.companies.some((company) => company.id === input.companyId) ||
    !scopes.data.branches.some(
      (branch) => branch.id === input.branchId && branch.companyId === input.companyId
    )
  ) {
    return { status: 'denied', rows: [], nextCursor: null, hasMore: false, correlationId: null };
  }

  const state = await readOperation<CursorPage<DeliveryReadinessRow>>(path);
  if (state.status !== 'ok') {
    // Every failure name `readOperation` produces is also a table status, so the
    // distinction between a refusal, an ended session and a fault survives all
    // the way to the operator instead of collapsing into one word here.
    return {
      status: state.status,
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: state.correlationId,
    };
  }
  return {
    status: 'ok',
    rows: state.data.items,
    nextCursor: state.data.nextCursor,
    hasMore: state.data.hasMore,
    correlationId: state.correlationId,
  };
}
