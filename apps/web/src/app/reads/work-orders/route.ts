import { serveBrowserRead } from '@/lib/api/read-route';
import { workOrderListQuery, workOrderListArgs } from '@/features/work-orders/work-order-list-read';
import { readWorkOrderList } from '@/features/work-orders/work-order-list-read.server';

/**
 * GET /reads/work-orders — the work-order board, cancellable (P1-32-PRE-OD-READ).
 *
 * Parses the query, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function GET(request: Request): Promise<Response> {
  return serveBrowserRead(request, workOrderListQuery, (query, signal) =>
    readWorkOrderList(...workOrderListArgs(query), signal)
  );
}
