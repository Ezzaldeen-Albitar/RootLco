import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND, query, type CursorPage } from '@/lib/api/read-operation';
import {
  isEmptyCriteria,
  normalizeCriteria,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
} from './directory-contract';

/**
 * The one customer search (`GET /api/v1/customers`) — SERVER ONLY.
 *
 * The body `searchCustomerDirectory` ran, moved here so the Server Action and
 * the GET route at `/reads/customer-directory` share one implementation
 * (P1-32-PRE-OD-READ). No directive: nothing here is a browser-callable
 * endpoint, and `authorizedClient()` reads the `httpOnly` cookie through
 * `next/headers`, which a client bundle does not have.
 * `tests/cancellable-reads.test.ts` fails when a client module reaches this
 * file. `signal` reaches the API call, so a caller that gives up stops it.
 *
 * `crm.customer.read`, tenant-scoped, cursor-paginated, `expensive-read`. See
 * `directory-contract.ts` for what the operation does and does not accept.
 *
 * ## It sends only what the contract accepts
 *
 * Six criteria plus `cursor` and `limit`. **No `sort`** — the route's schema is
 * `.strict()` and the operation publishes no sort parameter, so sending one is a
 * 422 rather than a differently-ordered page.
 *
 * ## A search that has not been asked for yet
 *
 * A caller must not reach the backend before the operator expresses intent —
 * partly because an unasked query is a wasted request against a 30-per-minute
 * budget, and partly because "here is everything" is not what a search surface
 * should say before it has been used.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

export async function readCustomerDirectory(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria,
  signal?: AbortSignal
): Promise<ServerPage<CustomerSearchHit>> {
  const criteria = normalizeCriteria(rawCriteria);
  if (isEmptyCriteria(criteria)) {
    // Not an error and not an empty result — the caller renders its "how to
    // search" state from this. Distinguished by the caller, which knows it never
    // submitted anything.
    return { ...EMPTY, status: 'ok', correlationId: null };
  }

  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };

  const path =
    '/api/v1/customers' +
    query({
      cursor,
      limit: request.pageSize,
      name: criteria.name,
      customerNumber: criteria.customerNumber,
      phone: criteria.phone,
      q: criteria.q,
      partyType: criteria.partyType,
      lifecycleStatus: criteria.lifecycleStatus,
    });

  // `retries: 0`. The shared client retries a read once by default, which is
  // right for a cheap lookup and wrong here: this operation is `expensive-read`
  // at 30 per minute, and a silent second attempt spends the operator's budget
  // twice for one search.
  const result = await client.get<CursorPage<CustomerSearchHit>>(path, {
    retries: 0,
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) {
    return {
      ...EMPTY,
      status: STATUS_BY_KIND[result.kind],
      correlationId: result.correlationId,
    };
  }

  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
    // Deliberately absent. The operation publishes no count, and `total: null`
    // is what makes a table render Previous/Next without a range instead of a
    // number it made up.
  };
}
