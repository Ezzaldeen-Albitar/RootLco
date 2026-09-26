import { z } from 'zod';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { acceptServerPage, browserRead, pageFailure, readParam } from '@/lib/api/browser-read';
import type { CustomerVehicleEntry } from './vehicles-contract';

/**
 * A customer's vehicles as a CANCELLABLE read (P1-32-PRE-OD-READ).
 *
 * The read the retired `listCustomerVehicles` Server Action performed, carried
 * by the GET route at `CUSTOMER_VEHICLES_ROUTE` so the browser can abort it
 * when the operator picks a different customer, and so it does not queue
 * behind another action on the page. This module is the route's contract and
 * the browser half; the server half is `vehicles-read.server.ts`.
 *
 * A GET, because it carries a customer identifier, a cursor and a page size
 * and nothing an operator typed.
 */

export const CUSTOMER_VEHICLES_ROUTE = '/reads/customer-vehicles';

export const customerVehiclesQuery = z
  .object({
    customerId: readParam.id,
    cursor: readParam.cursor.optional(),
    pageSize: readParam.pageSize,
  })
  .strict();

export type CustomerVehiclesQuery = z.infer<typeof customerVehiclesQuery>;

/** The core's arguments, as the parameters the query carries. */
export function customerVehiclesParams(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Record<string, string | undefined | null> {
  return { customerId, cursor, pageSize: String(request.pageSize) };
}

/** The parsed query, as the arguments the server core takes. */
export function customerVehiclesArgs(
  query: CustomerVehiclesQuery
): [string, TableRequest, string | null] {
  return [query.customerId, { ...INITIAL_REQUEST, pageSize: query.pageSize }, query.cursor ?? null];
}

/**
 * One page of a customer's vehicles, cancellable.
 *
 * Same arguments and same answer as the server core, plus the signal:
 * aborting it rejects with an `AbortError` (`isCancelledRead`) and closes the
 * request.
 */
export function listCustomerVehiclesCancellable(
  customerId: string,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<CustomerVehicleEntry>> {
  return browserRead({
    route: CUSTOMER_VEHICLES_ROUTE,
    method: 'GET',
    params: customerVehiclesParams(customerId, request, cursor),
    signal,
    accept: acceptServerPage<CustomerVehicleEntry>,
    failure: pageFailure<CustomerVehicleEntry>,
  });
}
