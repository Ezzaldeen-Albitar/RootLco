import { ApiClient } from './client';
import { readSessionToken } from './session-cookie';
import { env } from '@/lib/env';

/**
 * The API client as it exists on the SERVER.
 *
 * Two clients, one class. The difference is where the credential comes from:
 *
 *   - `anonymousClient()` — no session. Used by login, password reset, reset
 *     completion and activation, which are the four operations the backend
 *     publishes as `public: true` because a caller who cannot sign in cannot
 *     authenticate to ask.
 *   - `authorizedClient()` — reads the `httpOnly` session cookie and attaches
 *     `Authorization: Bearer`. Only reachable from a Server Component or a
 *     Server Action, because `next/headers` is not available anywhere else.
 *
 * There is deliberately no browser client that holds a token. The browser
 * cannot read the cookie, so it could not construct one even if a call site
 * wanted to — which is the property that makes "no token in browser storage"
 * structural rather than a rule someone has to remember.
 */

/** A client with no credential, for the four public authentication operations. */
export function anonymousClient(): ApiClient {
  return new ApiClient({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL });
}

/**
 * A client carrying the caller's bearer token, or `null` when there is no
 * session.
 *
 * Returning null rather than throwing is deliberate: "there is no session" is an
 * ordinary state that every protected page must handle by redirecting, and an
 * exception would make the ordinary path an error path.
 */
export async function authorizedClient(): Promise<ApiClient | null> {
  const token = await readSessionToken();
  if (!token) return null;
  return new ApiClient({
    baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    defaultHeaders: { authorization: `Bearer ${token}` },
  });
}

/**
 * A client carrying an explicitly supplied token.
 *
 * Used by sign-out, which must present the token it is about to invalidate
 * after the cookie has already been cleared — and by nothing else.
 */
export function clientWithToken(token: string): ApiClient {
  return new ApiClient({
    baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    defaultHeaders: { authorization: `Bearer ${token}` },
  });
}
