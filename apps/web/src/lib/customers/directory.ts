'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { readCustomerDirectory } from './directory-read.server';
import type { CustomerSearchCriteria, CustomerSearchHit } from './directory-contract';

/**
 * The one customer-search adapter (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * `GET /api/v1/customers` — `crm.customer.read`, tenant-scoped, cursor-paginated,
 * `expensive-read`. See `directory-contract.ts` for what the operation does and
 * does not accept.
 *
 * Moved here from `features/crm/customers/api.ts` in the D1 remediation so the
 * vehicle feature's customer selector can use it without importing across
 * features. The CRM search screen's `searchCustomers` delegates here — one
 * authority, several callers.
 *
 * ## Where the body lives now (P1-32-PRE-OD-READ)
 *
 * In `directory-read.server.ts`, shared with the GET route at
 * `/reads/customer-directory` that the search screen and the customer pickers
 * now read through, so the browser can cancel a superseded search instead of
 * only discarding its answer. This Server Action stays for any caller that
 * still invokes it, and answers exactly what it answered before.
 *
 * ## It runs on the server, and that is not incidental
 *
 * The bearer token lives in a `httpOnly` cookie the browser cannot read, so the
 * token never enters the client bundle, the client heap, or a network tab —
 * through this action or through the route. A selector still must not put its
 * query in the ADDRESS BAR: a customer name there is in history, in a referrer
 * and in every link somebody copies.
 *
 * The route is a GET, so the search term travels in ITS query string, as it
 * always has on the API request behind it. That request is a `fetch`, never a
 * navigation, so the term enters no history and no referrer; an access log in
 * front of the web tier that records query strings will see it, which is
 * written down in `route-checklist.md` under "Known limitations".
 */
export async function searchCustomerDirectory(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria
): Promise<ServerPage<CustomerSearchHit>> {
  return readCustomerDirectory(request, cursor, rawCriteria);
}
