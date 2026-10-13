import { pageFailure } from '@/lib/api/browser-read';
import { serveBrowserRead } from '@/lib/api/read-route';
import { vehicleSearchQuery, vehicleSearchArgs } from '@/features/vehicles/vehicle-search-read';
import { readVehicleSearch } from '@/features/vehicles/vehicle-search-read.server';

/**
 * POST /reads/vehicles — the vehicle search, cancellable (P1-32-PRE-OD-READ).
 *
 * A POST whose parameters are a JSON body: it carries text an operator typed,
 * and the Owner's rule is that search terms never go in the URL.
 *
 * Parses its body, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function POST(request: Request): Promise<Response> {
  return serveBrowserRead(request, {
    input: 'body',
    schema: vehicleSearchQuery,
    run: (params, signal) => readVehicleSearch(...vehicleSearchArgs(params), signal),
    failure: pageFailure,
  });
}
