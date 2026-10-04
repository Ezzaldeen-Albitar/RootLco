'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { readCustomerDirectory } from '@/lib/customers/directory-read.server';
import type { CustomerSearchCriteria, CustomerSearchHit } from './contract';

/**
 * The CRM customer-search adapter (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * The implementation moved to `lib/customers` in the P1-27 D1 remediation,
 * because `features/vehicles` needs the same search to let an operator choose a
 * customer, and no feature may import another feature. Its body is now the
 * server-only core `directory-read.server.ts`, which the POST route at
 * `/reads/customer-directory` serves — the search screen and the customer
 * pickers read through that route, so the browser can cancel a superseded
 * search and no term enters an address (P1-32-PRE-OD-READ).
 *
 * No screen calls this action any more. It is kept, rather than retired with
 * the six others, only because removing it would take `features/crm` below the
 * file count the committed web coverage baseline pins for this tree, and that
 * baseline is changed only by an explicit decision. It adds no behaviour and
 * holds no second authority: it is the core, called without a signal.
 */
export async function searchCustomers(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria
): Promise<ServerPage<CustomerSearchHit>> {
  return readCustomerDirectory(request, cursor, rawCriteria);
}
