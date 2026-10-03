import { authorizedClient } from '@/lib/api/server-client';
import { STATUS_BY_KIND, type ReadState } from '@/lib/api/read-operation';
import type { Outstanding } from './billing-contract';

/**
 * An invoice's balance and settlement (`sal.invoice-outstanding-read`) — SERVER
 * ONLY.
 *
 * Served by the GET route at `/reads/invoice-outstanding` (DX-2, finance QA
 * fixes E). No directive: nothing here is a browser-callable endpoint, and
 * `authorizedClient()` reads the `httpOnly` cookie through `next/headers`,
 * which a client bundle does not have. `tests/cancellable-reads.test.ts` fails
 * when a client module reaches this file. `signal` reaches the API call, so a
 * caller that gives up stops it.
 *
 * Money stays the API's exact decimal strings: the answer is passed through,
 * never re-read as a number.
 */
export async function readOutstandingState(
  invoiceId: string,
  signal?: AbortSignal
): Promise<ReadState<Outstanding>> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', correlationId: null };

  const path = `/api/v1/invoices/${encodeURIComponent(invoiceId)}/outstanding`;
  // The call the `readOutstanding` action makes — default retries — with the
  // signal added only when there is one, so a call without a signal is that
  // call exactly.
  const result = signal
    ? await client.get<Outstanding>(path, { signal })
    : await client.get<Outstanding>(path);
  if (result.ok) {
    return { status: 'ok', data: result.data, correlationId: result.correlationId };
  }
  return { status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
}
