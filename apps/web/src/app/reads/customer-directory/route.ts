import { serveBrowserRead } from '@/lib/api/read-route';
import { customerDirectoryQuery, customerDirectoryArgs } from '@/lib/customers/directory-read';
import { readCustomerDirectory } from '@/lib/customers/directory-read.server';

/**
 * GET /reads/customer-directory — the customer search, cancellable (P1-32-PRE-OD-READ).
 *
 * Parses the query, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function GET(request: Request): Promise<Response> {
  return serveBrowserRead(request, customerDirectoryQuery, (query, signal) =>
    readCustomerDirectory(...customerDirectoryArgs(query), signal)
  );
}
