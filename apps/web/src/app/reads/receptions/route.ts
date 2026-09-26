import { serveBrowserRead } from '@/lib/api/read-route';
import { receptionListQuery, receptionListArgs } from '@/features/receptions/reception-list-read';
import { readReceptionList } from '@/features/receptions/reception-list-read.server';

/**
 * GET /reads/receptions — the reception board, cancellable (P1-32-PRE-OD-READ).
 *
 * Parses the query, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function GET(request: Request): Promise<Response> {
  return serveBrowserRead(request, receptionListQuery, (query, signal) =>
    readReceptionList(...receptionListArgs(query), signal)
  );
}
