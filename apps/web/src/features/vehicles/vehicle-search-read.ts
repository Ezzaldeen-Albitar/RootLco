import { z } from 'zod';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { acceptServerPage, browserRead, pageFailure, readParam } from '@/lib/api/browser-read';
import {
  CRITERIA_KEYS,
  EMPTY_CRITERIA,
  isEmptyCriteria,
  normalizeCriteria,
  type VehicleSearchCriteria,
  type VehicleSearchHit,
} from './contract';

/**
 * Vehicle search as a CANCELLABLE read (P1-32-PRE-OD-READ).
 *
 * The same read `searchVehicles` performs, carried by the GET route at
 * `VEHICLE_SEARCH_ROUTE` instead of a Server Action so the browser can abort a
 * superseded search and so it does not queue behind another action on the
 * page. This module is the route's contract and the browser half; the server
 * half is `vehicle-search-read.server.ts`.
 *
 * Only the trimmed, non-empty criteria travel — `normalizeCriteria`, the same
 * function the server core applies before it builds the API request.
 */

export const VEHICLE_SEARCH_ROUTE = '/reads/vehicles';

export const vehicleSearchQuery = z
  .object({
    q: readParam.text.optional(),
    vin: readParam.text.optional(),
    plate: readParam.text.optional(),
    vehicleNumber: readParam.text.optional(),
    make: readParam.text.optional(),
    model: readParam.text.optional(),
    lifecycleStatus: readParam.text.optional(),
    powertrainCategory: readParam.text.optional(),
    cursor: readParam.cursor.optional(),
    pageSize: readParam.pageSize,
  })
  .strict();

export type VehicleSearchQuery = z.infer<typeof vehicleSearchQuery>;

/** The arguments `searchVehicles` takes, as query parameters. */
export function vehicleSearchParams(
  criteria: VehicleSearchCriteria,
  request: TableRequest,
  cursor: string | null
): Record<string, string | undefined | null> {
  return { ...normalizeCriteria(criteria), cursor, pageSize: String(request.pageSize) };
}

/** The parsed query, as the arguments the server core takes. */
export function vehicleSearchArgs(
  query: VehicleSearchQuery
): [VehicleSearchCriteria, TableRequest, string | null] {
  const criteria: Record<keyof VehicleSearchCriteria, string> = { ...EMPTY_CRITERIA };
  for (const key of CRITERIA_KEYS) {
    const value = query[key];
    if (value !== undefined) criteria[key] = value;
  }
  return [criteria, { ...INITIAL_REQUEST, pageSize: query.pageSize }, query.cursor ?? null];
}

/**
 * One page of the vehicle search, cancellable.
 *
 * Same arguments and same answer as `searchVehicles`, plus the signal: aborting
 * it rejects with an `AbortError` (`isCancelledRead`) and closes the request.
 * An empty search answers here, exactly as the server core would, without a
 * request.
 */
export async function searchVehiclesCancellable(
  criteria: VehicleSearchCriteria,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<VehicleSearchHit>> {
  if (isEmptyCriteria(criteria)) {
    return { status: 'ok', rows: [], nextCursor: null, hasMore: false, correlationId: null };
  }
  return browserRead({
    route: VEHICLE_SEARCH_ROUTE,
    params: vehicleSearchParams(criteria, request, cursor),
    signal,
    accept: acceptServerPage<VehicleSearchHit>,
    failure: pageFailure<VehicleSearchHit>,
  });
}
