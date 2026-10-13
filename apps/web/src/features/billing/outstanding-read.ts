import { z } from 'zod';
import { acceptReadState, browserRead, readFailure, readParam } from '@/lib/api/browser-read';
import type { ReadState } from '@/lib/api/read-operation';
import type { Outstanding } from './billing-contract';

/**
 * An invoice's balance and settlement as a CANCELLABLE read (DX-2, finance QA
 * fixes E).
 *
 * `sal.invoice-outstanding-read` — what is still due, the payment and credit
 * positions and when they were read — carried by the GET route at
 * `INVOICE_OUTSTANDING_ROUTE` rather than by a Server Action. The reason is
 * measured, not stylistic: the Next.js router runs Server Actions one at a time
 * (`app-router-instance.js`, `dispatchAction` appends to the queue while one is
 * pending and `runRemainingActions` starts the next only when it settles). With
 * the buyer-name lookup — itself an action — held unanswered, the counter-sale
 * settlement read queued behind it, and the copy offered Print without its
 * "Payments and credits as of" section while the sale panel still said
 * "Reading what has been paid…". A browser read is a `fetch`, which no action
 * can hold up, and the browser can abort it.
 *
 * This module is the route's contract and the browser half; the server half is
 * `outstanding-read.server.ts`. A GET, because it carries one identifier and
 * nothing an operator typed.
 */

export const INVOICE_OUTSTANDING_ROUTE = '/reads/invoice-outstanding';

export const invoiceOutstandingQuery = z
  .object({
    invoiceId: readParam.id,
  })
  .strict();

export type InvoiceOutstandingQuery = z.infer<typeof invoiceOutstandingQuery>;

/** The parameters the browser half sends for one invoice. */
export function invoiceOutstandingParams(
  invoiceId: string
): Record<string, string | undefined | null> {
  return { invoiceId };
}

/** The core's arguments, from a parsed query. */
export function invoiceOutstandingArgs(query: InvoiceOutstandingQuery): [string] {
  return [query.invoiceId];
}

/**
 * The balance of one invoice, cancellable and bounded.
 *
 * Bounded by `browserRead`'s own ceiling, which aborts the request and answers
 * `unavailable`; rejects only when `signal` was aborted.
 */
export function readOutstandingCancellable(
  invoiceId: string,
  signal?: AbortSignal
): Promise<ReadState<Outstanding>> {
  return browserRead({
    route: INVOICE_OUTSTANDING_ROUTE,
    method: 'GET',
    params: invoiceOutstandingParams(invoiceId),
    signal,
    accept: acceptReadState<Outstanding>,
    failure: readFailure<Outstanding>,
  });
}
