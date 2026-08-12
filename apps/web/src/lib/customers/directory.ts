'use server';

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
 * The one customer-search adapter (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * `GET /api/v1/customers` — `crm.customer.read`, tenant-scoped, cursor-paginated,
 * `expensive-read`. See `directory-contract.ts` for what the operation does and
 * does not accept; this file only turns criteria into that request and the
 * response into a view state.
 *
 * Moved here from `features/crm/customers/api.ts` in the D1 remediation so the
 * vehicle feature's customer selector can use it without importing across
 * features. The CRM search screen still calls `searchCustomers`, which now
 * delegates here — one authority, two callers.
 *
 * ## It runs on the server, and that is not incidental
 *
 * The bearer token lives in a `httpOnly` cookie the browser cannot read. Every
 * read goes through a Server Action, so the token never enters the client
 * bundle, the client heap, or a network tab — and the operator's search terms
 * travel as an encoded parameter of a POST-backed action rather than as part of
 * a navigable URL. That last point is why a selector must not put its query in
 * the address bar: a customer name in a URL is in history, in a referrer, and in
 * every proxy log between here and the operator.
 *
 * ## It sends only what the contract accepts
 *
 * Four criteria plus `cursor` and `limit`. **No `sort`** — the route's schema is
 * `.strict()` and the operation publishes no sort parameter, so sending one is a
 * 422 rather than a differently-ordered page.
 */

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

/**
 * A search that has not been asked for yet.
 *
 * A caller must not reach the backend before the operator expresses intent —
 * partly because an unasked query is a wasted request against a 30-per-minute
 * budget, and partly because "here is everything" is not what a search surface
 * should say before it has been used.
 */
export async function searchCustomerDirectory(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria
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
      partyType: criteria.partyType,
      lifecycleStatus: criteria.lifecycleStatus,
    });

  // `retries: 0`. The shared client retries a read once by default, which is
  // right for a cheap lookup and wrong here: this operation is `expensive-read`
  // at 30 per minute, and a silent second attempt spends the operator's budget
  // twice for one search.
  const result = await client.get<CursorPage<CustomerSearchHit>>(path, { retries: 0 });
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
