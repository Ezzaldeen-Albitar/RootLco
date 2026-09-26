import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchScopeQuery,
  type BranchScope,
  type CursorPage,
} from '@/lib/api/read-operation';
import type { ReceptionListCriteria, ReceptionListEntry } from './receptions-contract';

/**
 * The reception board read (`rec.reception-list`) — SERVER ONLY.
 *
 * The body `listReceptions` ran, moved here so the Server Action and the GET
 * route at `/reads/receptions` share one implementation (P1-32-PRE-OD-READ).
 * No directive: nothing here is a browser-callable endpoint, and
 * `authorizedClient()` reads the `httpOnly` cookie through `next/headers`,
 * which a client bundle does not have. `tests/cancellable-reads.test.ts` fails
 * when a client module reaches this file.
 *
 * `retries: 0` — `expensive-read`, and the table offers Retry.
 *
 * ## The branch may be left unnamed, and that is a REQUEST rather than a gap
 *
 * The scope travels through `branchScopeQuery`: the company is always named, and
 * the branch is named when the operator is working in one and omitted when they
 * have chosen "all my branches". An omitted branch asks the API for every branch
 * of that company the caller may read, and the API resolves that set one branch
 * at a time against `rec.reception.read`, refusing a caller that holds none — so
 * the omission never widens what this operator is entitled to see. Every row
 * carries its own `branchId` back, which is what lets the board say where each
 * car is.
 *
 * Every criterion is named explicitly rather than spread. A spread would put an
 * arbitrary caller-supplied key into the query builder, and the builder's throw
 * on a scope name is the last line of defence rather than the first.
 *
 * `signal` reaches the API call, so a caller that gives up stops the request.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function readReceptionList(
  scope: BranchScope,
  criteria: ReceptionListCriteria,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<ReceptionListEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/receptions' +
    branchScopeQuery(scope, {
      status: criteria.status,
      // Never both: the route refuses the pair rather than intersecting it.
      statusGroup: criteria.statusGroup,
      vehicleId: criteria.vehicleId,
      from: criteria.from,
      to: criteria.to,
      q: criteria.q,
      cursor,
      limit: request.pageSize,
    });

  const result = await client.get<CursorPage<ReceptionListEntry>>(path, {
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
