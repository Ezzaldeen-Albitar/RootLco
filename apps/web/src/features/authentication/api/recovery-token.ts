import type { Locale } from '@/i18n/config';

/**
 * Reading a recovery token out of the link that carried it.
 *
 * Providers deliver a recovery link in one of two shapes: a query parameter, or
 * a URL fragment (`#access_token=…`), which never reaches the server at all.
 * This resolves the query-parameter form server-side; the fragment form is
 * handled by `RecoveryTokenBridge`, which is the only reason that component
 * exists.
 *
 * ## Bounds, not trust
 *
 * The token is checked for *shape* only — length and character class — because
 * the token belongs to the identity provider and only the provider can say
 * whether it is valid. Checking shape here stops a 20-kilobyte query parameter
 * from being posted, and stops obviously-not-a-token text reaching the request
 * body. It never implies the token is good.
 *
 * The bound matches the backend's own contract: `z.string().min(8).max(2048)` on
 * `POST /api/v1/auth/password-reset/completion`.
 */

const MIN = 8;
const MAX = 2048;
/** Base64URL / JWT-ish. Deliberately permissive within a bounded alphabet. */
const SHAPE = /^[A-Za-z0-9._~+/=-]+$/;

/** The query parameter names providers use for a recovery token. */
export const TOKEN_PARAMS = ['token', 'access_token', 'code'] as const;

export function tokenFromQuery(
  query: Record<string, string | string[] | undefined>
): string | null {
  for (const name of TOKEN_PARAMS) {
    const raw = query[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string' && isTokenShaped(value)) return value;
  }
  return null;
}

export function isTokenShaped(value: string): boolean {
  return value.length >= MIN && value.length <= MAX && SHAPE.test(value);
}

/**
 * Where a completed reset sends the operator.
 *
 * A fixed, locale-scoped path. There is no `next`, `returnTo` or `redirect`
 * parameter anywhere in this flow, and that is the point: an open redirect on
 * the page that completes a credential change is the highest-value one in any
 * application, because the visitor arrived from an email and is primed to trust
 * whatever it shows them next.
 */
export function afterResetPath(locale: Locale): string {
  return `/${locale}/login`;
}
