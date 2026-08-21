'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { searchCustomerDirectory } from '@/lib/customers/directory';
import type { CustomerSearchCriteria, CustomerSearchHit } from './contract';

/**
 * The CRM customer-search adapter (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * The implementation moved to `@/lib/customers/directory` in the P1-27 D1
 * remediation, because `features/vehicles` needs the same search to let an
 * operator choose a customer, and no feature may import another feature.
 *
 * This wrapper exists rather than a bare re-export for one reason: a
 * `'use server'` module's exports are the Server Action boundary, and an
 * explicitly declared `async function` states that boundary at the call site the
 * CRM screen actually uses. It adds no behaviour and holds no second authority.
 */
export async function searchCustomers(
  request: TableRequest,
  cursor: string | null,
  rawCriteria: CustomerSearchCriteria
): Promise<ServerPage<CustomerSearchHit>> {
  return searchCustomerDirectory(request, cursor, rawCriteria);
}
