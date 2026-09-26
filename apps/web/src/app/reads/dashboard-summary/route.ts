import { serveBrowserRead } from '@/lib/api/read-route';
import {
  dashboardSummaryQuery,
  dashboardSummaryArgs,
} from '@/features/overview/dashboard-summary-read';
import { readDashboardSummaryState } from '@/features/overview/dashboard-summary-read.server';

/**
 * GET /reads/dashboard-summary — the operations overview figures, cancellable (P1-32-PRE-OD-READ).
 *
 * Parses the query, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function GET(request: Request): Promise<Response> {
  return serveBrowserRead(request, dashboardSummaryQuery, (query, signal) =>
    readDashboardSummaryState(...dashboardSummaryArgs(query), signal)
  );
}
