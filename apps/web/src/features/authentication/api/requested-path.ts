import { headers } from 'next/headers';
import { safeIntendedPath } from './intended-path';
import { REQUESTED_PATH_HEADER } from './requested-path-header';

/**
 * The path of the request being served, as `src/proxy.ts` recorded it, when it
 * is one sign-in may carry; otherwise null (P1-32-PRE-OD-AUTHB).
 *
 * The ONE reader of the header, and the check is here on purpose: the proxy does
 * not run on every request (`requested-path-header.ts`), so what arrives may be
 * what a client sent. Nothing may read the header around this function.
 *
 * A path only — the proxy never records the query string, so nothing a screen
 * keeps out of the address can leak into the sign-in page's. Read only when a
 * protected render is about to redirect to sign-in; a page that renders never
 * asks.
 *
 * Kept apart from `intended-path.ts` because this one reads the request and
 * that one must stay importable by plain unit tests.
 */
export async function requestedPath(): Promise<string | null> {
  const store = await headers();
  return safeIntendedPath(store.get(REQUESTED_PATH_HEADER));
}
