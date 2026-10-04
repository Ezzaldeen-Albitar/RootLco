import { pageFailure } from '@/lib/api/browser-read';
import { serveBrowserRead } from '@/lib/api/read-route';
import { workOrderListQuery, workOrderListArgs } from '@/features/work-orders/work-order-list-read';
import { readWorkOrderList } from '@/features/work-orders/work-order-list-read.server';

/**
 * POST /reads/work-orders — the work-order board, cancellable (P1-32-PRE-OD-READ).
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
    schema: workOrderListQuery,
    run: (params, signal) => readWorkOrderList(...workOrderListArgs(params), signal),
    failure: pageFailure,
  });
}
