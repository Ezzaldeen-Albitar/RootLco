import { z } from 'zod';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { acceptServerPage, browserRead, pageFailure, readParam } from '@/lib/api/browser-read';
import type { BranchScope } from '@/lib/api/read-operation';
import {
  RECEPTION_STATUSES,
  RECEPTION_STATUS_GROUPS,
  type ReceptionListCriteria,
  type ReceptionListEntry,
} from './receptions-contract';

/**
 * The reception board as a CANCELLABLE read (P1-32-PRE-OD-READ).
 *
 * The read the retired `listReceptions` Server Action performed, carried by
 * the POST route at `RECEPTION_LIST_ROUTE` so the browser can abort it and so
 * it does not queue behind another action on the page. This module is the
 * route's contract — one schema both halves use — and the browser half. The
 * server half is `reception-list-read.server.ts`.
 *
 * Its parameters travel as a JSON body, never in the address: the Owner's
 * rule is that search terms never go in the URL.
 */

export const RECEPTION_LIST_ROUTE = '/reads/receptions';

/** The body the route accepts: the scope, the named criteria, a cursor and a page size. */
export const receptionListQuery = z
  .object({
    companyId: readParam.id,
    branchId: readParam.id.optional(),
    status: z.enum(RECEPTION_STATUSES).optional(),
    statusGroup: z.enum(RECEPTION_STATUS_GROUPS).optional(),
    vehicleId: readParam.id.optional(),
    from: readParam.text.optional(),
    to: readParam.text.optional(),
    q: readParam.text.optional(),
    cursor: readParam.cursor.optional(),
    pageSize: readParam.pageSize,
  })
  .strict();

export type ReceptionListQuery = z.infer<typeof receptionListQuery>;

/** The core's arguments, as the parameters the JSON body carries. */
export function receptionListParams(
  scope: BranchScope,
  criteria: ReceptionListCriteria,
  request: TableRequest,
  cursor: string | null
): Record<string, string | undefined | null> {
  return {
    companyId: scope.companyId,
    branchId: scope.branchId,
    status: criteria.status,
    statusGroup: criteria.statusGroup,
    vehicleId: criteria.vehicleId,
    from: criteria.from,
    to: criteria.to,
    q: criteria.q,
    cursor,
    pageSize: String(request.pageSize),
  };
}

/** The parsed body, as the arguments the server core takes. */
export function receptionListArgs(
  query: ReceptionListQuery
): [BranchScope, ReceptionListCriteria, TableRequest, string | null] {
  return [
    { companyId: query.companyId, branchId: query.branchId ?? null },
    {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.statusGroup === undefined ? {} : { statusGroup: query.statusGroup }),
      ...(query.vehicleId === undefined ? {} : { vehicleId: query.vehicleId }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.q === undefined ? {} : { q: query.q }),
    },
    { ...INITIAL_REQUEST, pageSize: query.pageSize },
    query.cursor ?? null,
  ];
}

/**
 * One page of the reception board, cancellable.
 *
 * Same arguments and same answer as the server core, plus the signal: aborting
 * it rejects with an `AbortError` (`isCancelledRead`) and closes the request.
 */
export function listReceptionsCancellable(
  scope: BranchScope,
  criteria: ReceptionListCriteria,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<ReceptionListEntry>> {
  return browserRead({
    route: RECEPTION_LIST_ROUTE,
    method: 'POST',
    params: receptionListParams(scope, criteria, request, cursor),
    signal,
    accept: acceptServerPage<ReceptionListEntry>,
    failure: pageFailure<ReceptionListEntry>,
  });
}
