'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import type {
  OdometerReadingEntry,
  OwnershipHistoryEntry,
  PlateHistoryEntry,
} from './history-contract';

/**
 * Vehicle history reads (`FE-021`, `FE-022`, `FE-023`).
 *
 * ## These five sub-resource GETs never check that the vehicle exists
 *
 * An unknown, soft-deleted or cross-tenant `vehicleId` yields an **empty 200
 * page**, not a 404 — while `veh.vehicle-read` on the same id answers 404. The
 * two are inconsistent, and a screen that trusted either alone would be wrong
 * half the time.
 *
 * So every history section is rendered **beneath a vehicle already read by the
 * page**. The 404 is decided once, by the detail read, and an empty history
 * section below a vehicle that demonstrably exists means what it says: no rows.
 *
 * ## The cursors are microsecond-safe as of `P1-27-INT-008`
 *
 * All three of these operations minted their cursor from a JS `Date` until
 * PR #197. They now select `cursorTimestamp(...)`, so a page walk over rows
 * written in one transaction no longer skips the siblings of the row it stopped
 * on. Nothing here reconstructs a cursor from a published timestamp.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * One history list.
 *
 * `segment` comes from the three exported functions and never from a caller;
 * the vehicle id is encoded. A segment arriving from a URL could otherwise walk
 * to a different operation.
 */
async function listHistory<Row>(
  vehicleId: string,
  segment: 'ownerships' | 'plates' | 'odometer-readings',
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<Row>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    `/api/v1/vehicles/${encodeURIComponent(vehicleId)}/${segment}` +
    query({ cursor, limit: request.pageSize });

  const result = await client.get<CursorPage<Row>>(path, { retries: 0 });
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
    // No `total`. These operations publish `hasMore` and nothing else.
  };
}

export async function listOwnerships(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<OwnershipHistoryEntry>> {
  return listHistory<OwnershipHistoryEntry>(vehicleId, 'ownerships', request, cursor);
}

export async function listPlates(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<PlateHistoryEntry>> {
  return listHistory<PlateHistoryEntry>(vehicleId, 'plates', request, cursor);
}

export async function listOdometerReadings(
  vehicleId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<OdometerReadingEntry>> {
  return listHistory<OdometerReadingEntry>(vehicleId, 'odometer-readings', request, cursor);
}
