import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  isEmptyCriteria,
  normalizeCriteria,
  type VehicleSearchCriteria,
  type VehicleSearchHit,
} from './contract';

/**
 * Vehicle search (`FE-017`) — SERVER ONLY.
 *
 * The body the retired `searchVehicles` action ran, now served only by the
 * POST route at `/reads/vehicles` (P1-32-PRE-OD-READ). No
 * directive: nothing here is a browser-callable endpoint, and
 * `authorizedClient()` reads the `httpOnly` cookie through `next/headers`,
 * which a client bundle does not have. `tests/cancellable-reads.test.ts` fails
 * when a client module reaches this file. `signal` reaches the API call, so a
 * caller that gives up stops it.
 *
 * ## Search sends only the parameters the schema names
 *
 * The query schema is `.strict()`, so an unknown parameter is a 422 for the
 * whole request rather than a silently ignored extra. There is no `sort`, no
 * `page`, no `total`, and nothing is added for convenience.
 *
 * `retries: 0`, because search is `expensive-read` — 30 requests per minute per
 * user. A transparent retry would spend a second slot of a small budget on a
 * request the operator did not make, and the screen already offers Retry.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function readVehicleSearch(
  criteria: VehicleSearchCriteria,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<VehicleSearchHit>> {
  // Refused rather than sent. An unfiltered search is a full scan against an
  // expensive-read budget, and the screen has no reason to ask for one.
  if (isEmptyCriteria(criteria)) {
    return { ...EMPTY, status: 'ok', correlationId: null };
  }

  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/vehicles' + query({ ...normalizeCriteria(criteria), cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<VehicleSearchHit>>(path, {
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
    // No `total`. The operation publishes `hasMore` and nothing else.
  };
}
