'use server';

import type { ServerPage } from '@/components/data-table/use-server-table';
import type { TableRequest } from '@/components/data-table/table-state';
import { readCustomerVehicles } from './vehicles-read.server';
import type { CustomerVehicleEntry } from './vehicles-contract';

/**
 * The customer→vehicle list adapter (`crm.customer-vehicle-list`).
 *
 * See `vehicles-contract.ts` for the contract and for why this module lives
 * here rather than in a feature. The body lives in `vehicles-read.server.ts`,
 * shared with the GET route at `/reads/customer-vehicles` that the vehicle
 * pickers now read through so the browser can cancel the read
 * (P1-32-PRE-OD-READ). This Server Action stays for any caller that still
 * invokes it, and answers exactly what it answered before.
 */
export async function listCustomerVehicles(
  customerId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<CustomerVehicleEntry>> {
  return readCustomerVehicles(customerId, request, cursor);
}
