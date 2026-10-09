import { headers } from 'next/headers';
import { REQUESTED_PATH_HEADER, safeIntendedPath } from './intended-path';

/**
 * The path of the request being served, as `src/proxy.ts` recorded it, when it
 * is one sign-in may carry; otherwise null (P1-32-PRE-OD-AUTHB).
 *
 * A path only — the proxy never records the query string, so nothing a screen
 * keeps out of the address can leak into the sign-in page's. Read only when a
 * protected render is about to redirect to sign-in; a page that renders never
 * asks.
 *
 * Kept apart from `intended-path.ts` because this one reads the request and
 * that one must stay importable by the proxy and by plain unit tests.
 */
export async function requestedPath(): Promise<string | null> {
  const store = await headers();
  return safeIntendedPath(store.get(REQUESTED_PATH_HEADER));
}
