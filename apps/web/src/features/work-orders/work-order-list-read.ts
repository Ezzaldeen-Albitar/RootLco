import { z } from 'zod';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import {
  acceptServerPage,
  browserRead,
  flagParam,
  flagValue,
  pageFailure,
  readParam,
} from '@/lib/api/browser-read';
import type { BranchScope } from '@/lib/api/read-operation';
import {
  WORK_ORDER_KINDS,
  WORK_ORDER_STATE_GROUPS,
  type WorkOrderListCriteria,
  type WorkOrderListEntry,
} from './work-orders-contract';

/**
 * The work-order board as a CANCELLABLE read (P1-32-PRE-OD-READ).
 *
 * The read the retired `listWorkOrders` Server Action performed, carried by
 * the POST route at `WORK_ORDER_LIST_ROUTE` so the browser can abort it and so
 * it does not queue behind another action on the page. This module is the
 * route's contract and the browser half; the server half is
 * `work-order-list-read.server.ts`.
 *
 * Its parameters travel as a JSON body, never in the address: the Owner's
 * rule is that search terms never go in the URL.
 *
 * `state` stays free text: the state catalogue is tenant-extensible, so the
 * route cannot know every code, and the API refuses one it does not.
 */

export const WORK_ORDER_LIST_ROUTE = '/reads/work-orders';

const FLAGS = [
  'assignedToMe',
  'awaitingParts',
  'awaitingApproval',
  'awaitingQuality',
  'readyForDelivery',
] as const;

export const workOrderListQuery = z
  .object({
    companyId: readParam.id,
    branchId: readParam.id.optional(),
    state: readParam.text.optional(),
    stateGroup: z.enum(WORK_ORDER_STATE_GROUPS).optional(),
    kind: z.enum(WORK_ORDER_KINDS).optional(),
    openedFrom: readParam.text.optional(),
    openedTo: readParam.text.optional(),
    completedFrom: readParam.text.optional(),
    completedTo: readParam.text.optional(),
    customerId: readParam.id.optional(),
    q: readParam.text.optional(),
    assignedToMe: readParam.flag.optional(),
    awaitingParts: readParam.flag.optional(),
    awaitingApproval: readParam.flag.optional(),
    awaitingQuality: readParam.flag.optional(),
    readyForDelivery: readParam.flag.optional(),
    cursor: readParam.cursor.optional(),
    pageSize: readParam.pageSize,
  })
  .strict();

export type WorkOrderListQuery = z.infer<typeof workOrderListQuery>;

/** The core's arguments, as the parameters the JSON body carries. */
export function workOrderListParams(
  scope: BranchScope,
  criteria: WorkOrderListCriteria,
  request: TableRequest,
  cursor: string | null
): Record<string, string | undefined | null> {
  return {
    companyId: scope.companyId,
    branchId: scope.branchId,
    state: criteria.state,
    stateGroup: criteria.stateGroup,
    kind: criteria.kind,
    openedFrom: criteria.openedFrom,
    openedTo: criteria.openedTo,
    completedFrom: criteria.completedFrom,
    completedTo: criteria.completedTo,
    customerId: criteria.customerId,
    q: criteria.q,
    assignedToMe: flagParam(criteria.assignedToMe),
    awaitingParts: flagParam(criteria.awaitingParts),
    awaitingApproval: flagParam(criteria.awaitingApproval),
    awaitingQuality: flagParam(criteria.awaitingQuality),
    readyForDelivery: flagParam(criteria.readyForDelivery),
    cursor,
    pageSize: String(request.pageSize),
  };
}

/** The parsed body, as the arguments the server core takes. */
export function workOrderListArgs(
  query: WorkOrderListQuery
): [BranchScope, WorkOrderListCriteria, TableRequest, string | null] {
  const criteria: Record<string, string | boolean> = {};
  for (const key of [
    'state',
    'stateGroup',
    'kind',
    'openedFrom',
    'openedTo',
    'completedFrom',
    'completedTo',
    'customerId',
    'q',
  ] as const) {
    const value = query[key];
    if (value !== undefined) criteria[key] = value;
  }
  for (const key of FLAGS) {
    const value = flagValue(query[key]);
    if (value !== undefined) criteria[key] = value;
  }
  return [
    { companyId: query.companyId, branchId: query.branchId ?? null },
    criteria as WorkOrderListCriteria,
    { ...INITIAL_REQUEST, pageSize: query.pageSize },
    query.cursor ?? null,
  ];
}

/**
 * One page of the work-order board, cancellable.
 *
 * Same arguments and same answer as the server core, plus the signal: aborting
 * it rejects with an `AbortError` (`isCancelledRead`) and closes the request.
 */
export function listWorkOrdersCancellable(
  scope: BranchScope,
  criteria: WorkOrderListCriteria,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<WorkOrderListEntry>> {
  return browserRead({
    route: WORK_ORDER_LIST_ROUTE,
    method: 'POST',
    params: workOrderListParams(scope, criteria, request, cursor),
    signal,
    accept: acceptServerPage<WorkOrderListEntry>,
    failure: pageFailure<WorkOrderListEntry>,
  });
}
