import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import type { CustomerVehicleEntry } from './vehicles-contract';

/**
 * The customer→vehicle list (`crm.customer-vehicle-list`) — SERVER ONLY.
 *
 * The body `listCustomerVehicles` ran, moved here so the Server Action and the
 * GET route at `/reads/customer-vehicles` share one implementation
 * (P1-32-PRE-OD-READ). No directive: nothing here is a browser-callable
 * endpoint, and `authorizedClient()` reads the `httpOnly` cookie through
 * `next/headers`, which a client bundle does not have.
 * `tests/cancellable-reads.test.ts` fails when a client module reaches this
 * file. `signal` reaches the API call, so a caller that gives up stops it.
 *
 * The read sends exactly what the `.strict()` schema names — `cursor` and
 * `limit` — and nothing else; there is no filter, no sort and no total to send
 * or invent. `retries: 0`: the operation is `expensive-read`, and the screens
 * that call this already offer Retry.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function readCustomerVehicles(
  customerId: string,
  request: TableRequest,
  cursor: string | null,
  signal?: AbortSignal
): Promise<ServerPage<CustomerVehicleEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/customers/${encodeURIComponent(customerId)}/vehicles` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<CustomerVehicleEntry>>(path, {
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
