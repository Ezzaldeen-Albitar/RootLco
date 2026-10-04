import { readFailure } from '@/lib/api/browser-read';
import { serveBrowserRead } from '@/lib/api/read-route';
import {
  invoiceOutstandingArgs,
  invoiceOutstandingQuery,
} from '@/features/billing/outstanding-read';
import { readOutstandingState } from '@/features/billing/outstanding-read.server';

/**
 * GET /reads/invoice-outstanding — an invoice's balance and settlement,
 * cancellable (DX-2, finance QA fixes E).
 *
 * A GET with a query: it carries one identifier and nothing an operator typed.
 *
 * Parses its query, calls ONE server read core with this request's signal, and
 * returns its envelope; `serveBrowserRead` holds the refusals and the headers.
 * Authorization, tenant and branch scope and the rate limit stay in the API.
 */
export function GET(request: Request): Promise<Response> {
  return serveBrowserRead(request, {
    input: 'query',
    schema: invoiceOutstandingQuery,
    run: (params, signal) => readOutstandingState(...invoiceOutstandingArgs(params), signal),
    failure: readFailure,
  });
}
