import { z } from 'zod';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { acceptServerPage, browserRead, pageFailure, readParam } from '@/lib/api/browser-read';
import {
  LIFECYCLE_STATUSES,
  PARTY_TYPES,
  isEmptyCriteria,
  normalizeCriteria,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
} from './directory-contract';

/**
 * The customer search as a CANCELLABLE read (P1-32-PRE-OD-READ).
 *
 * The same read `searchCustomerDirectory` performs, carried by the GET route at
 * `CUSTOMER_DIRECTORY_ROUTE` instead of a Server Action so the browser can abort
 * a superseded search and so it does not queue behind another action on the
 * page. This module is the route's contract and the browser half; the server
 * half is `directory-read.server.ts`.
 *
 * The criteria are normalised HERE before they travel, with the same function
 * the server core applies again, so the route sees what the API will be sent:
 * trimmed, bounded, and without a free-text value too short to accept.
 */

export const CUSTOMER_DIRECTORY_ROUTE = '/reads/customer-directory';

export const customerDirectoryQuery = z
  .object({
    name: readParam.text.optional(),
    customerNumber: readParam.text.optional(),
    phone: readParam.text.optional(),
    q: readParam.text.optional(),
    partyType: z.enum(PARTY_TYPES).optional(),
    lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
    cursor: readParam.cursor.optional(),
    pageSize: readParam.pageSize,
  })
  .strict();

export type CustomerDirectoryQuery = z.infer<typeof customerDirectoryQuery>;

/** The arguments `searchCustomerDirectory` takes, as query parameters. */
export function customerDirectoryParams(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria
): Record<string, string | undefined | null> {
  const criteria = normalizeCriteria(rawCriteria);
  return {
    name: criteria.name,
    customerNumber: criteria.customerNumber,
    phone: criteria.phone,
    q: criteria.q,
    partyType: criteria.partyType,
    lifecycleStatus: criteria.lifecycleStatus,
    cursor,
    pageSize: String(request.pageSize),
  };
}

/** The parsed query, as the arguments the server core takes. */
export function customerDirectoryArgs(
  query: CustomerDirectoryQuery
): [TableRequest, string | null, CustomerSearchCriteria] {
  return [
    { ...INITIAL_REQUEST, pageSize: query.pageSize },
    query.cursor ?? null,
    {
      ...(query.name === undefined ? {} : { name: query.name }),
      ...(query.customerNumber === undefined ? {} : { customerNumber: query.customerNumber }),
      ...(query.phone === undefined ? {} : { phone: query.phone }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.partyType === undefined ? {} : { partyType: query.partyType }),
      ...(query.lifecycleStatus === undefined ? {} : { lifecycleStatus: query.lifecycleStatus }),
    },
  ];
}

/**
 * One page of the customer search, cancellable.
 *
 * Same arguments and same answer as `searchCustomerDirectory`, plus the signal:
 * aborting it rejects with an `AbortError` (`isCancelledRead`) and closes the
 * request. A search with nothing to search on answers here, exactly as the
 * server core would, without a request.
 */
export async function searchCustomerDirectoryCancellable(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria,
  signal?: AbortSignal
): Promise<ServerPage<CustomerSearchHit>> {
  if (isEmptyCriteria(normalizeCriteria(rawCriteria))) {
    return { status: 'ok', rows: [], nextCursor: null, hasMore: false, correlationId: null };
  }
  return browserRead({
    route: CUSTOMER_DIRECTORY_ROUTE,
    params: customerDirectoryParams(request, cursor, rawCriteria),
    signal,
    accept: acceptServerPage<CustomerSearchHit>,
    failure: pageFailure<CustomerSearchHit>,
  });
}
