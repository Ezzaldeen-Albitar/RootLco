import { pageFailure } from '@/lib/api/browser-read';
import { serveBrowserRead } from '@/lib/api/read-route';
import { customerVehiclesQuery, customerVehiclesArgs } from '@/lib/customers/vehicles-read';
import { readCustomerVehicles } from '@/lib/customers/vehicles-read.server';

/**
 * GET /reads/customer-vehicles — a customer's vehicles, cancellable (P1-32-PRE-OD-READ).
 *
 * A GET with a query: it carries identifiers and nothing an operator typed.
 *
 * Parses its query, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function GET(request: Request): Promise<Response> {
  return serveBrowserRead(request, {
    input: 'query',
    schema: customerVehiclesQuery,
    run: (params, signal) => readCustomerVehicles(...customerVehiclesArgs(params), signal),
    failure: pageFailure,
  });
}
