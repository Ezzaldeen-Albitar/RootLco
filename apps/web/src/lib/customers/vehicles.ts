'use server';

import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import type { ServerPage } from '@/components/data-table/use-server-table';
import type { TableRequest } from '@/components/data-table/table-state';
import type { CustomerVehicleEntry } from './vehicles-contract';

/**
 * The customer→vehicle list adapter (`crm.customer-vehicle-list`).
 *
 * See `vehicles-contract.ts` for the contract and for why this module lives
 * here rather than in a feature. The read sends exactly what the `.strict()`
 * schema names — `cursor` and `limit` — and nothing else; there is no filter,
 * no sort and no total to send or invent.
 *
 * `retries: 0`: the operation is `expensive-read`, and the screens that call
 * this already offer Retry.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function listCustomerVehicles(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<CustomerVehicleEntry>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/customers/${encodeURIComponent(customerId)}/vehicles` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<CustomerVehicleEntry>>(path, { retries: 0 });
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
