import { NAVIGATION, flattenNavigation, isActive, type NavigationGroup } from '@/config/navigation';
import { PLATFORM_NAVIGATION } from '@/config/platform-navigation';
import { isLocale, type Locale } from '@/i18n/config';
import { visibleNavigation } from '@/lib/permissions';
import { SESSION_ENDED_SEGMENT } from './session-ended';

/**
 * The page an operator was opening when a sign-in was required, and the rules
 * that decide whether sign-in may send them back to it (P1-32-PRE-OD-AUTHB).
 *
 * ## Why this is not an open redirect
 *
 * P1-26 forbade a redirect destination anywhere in the authentication flow, for
 * a sound reason: a link that ends a credential step and then forwards wherever
 * its query string says lets anyone who can send the operator a link choose the
 * page they see next, on the one screen they have just been taught to trust. The
 * password-reset and activation pages still carry no destination at all.
 *
 * What returns an operator to their page after sign-in is narrower than a
 * destination, and every hop re-checks it:
 *
 *   1. It is only ever a PATH of this application — `/{locale}/{segment}…`
 *      with a supported locale and an application area as its first segment.
 *      `safeIntendedPath` is an allow-list, not a deny-list: anything that is
 *      not that shape is refused, which covers an absolute address, a
 *      protocol-relative `//host`, a backslash (`/\host`, which browsers read
 *      as `//host`), a scheme (`javascript:`), any percent-encoding (so an
 *      encoded slash, dot or scheme cannot be decoded into one later), a dot
 *      segment, an empty segment, a query, a fragment, white space and control
 *      characters. It is bounded in length.
 *   2. It is never followed by the sign-in page, the session-ended handler or
 *      `requireSession`. Each of them only carries it forward, re-checked, to
 *      the next step.
 *   3. It is followed exactly once — after the credentials were accepted — and
 *      only when the new session may open it (`permitsIntendedPath`), by the
 *      same rule the sidebar uses to offer a screen. Otherwise the operator lands
 *      where they always did.
 *
 * Hiding a page the session may not open is usability, not access control: the
 * page's own read is refused by the server whatever the address says.
 */

/** The query parameter the sign-in page and the session-ended handler carry. */
export const INTENDED_PATH_PARAM = 'intended';

/** Longer than any route this application serves, short enough to bound the work. */
export const INTENDED_PATH_MAX_LENGTH = 512;

/**
 * One path segment: letters, digits, `-` and `_`, starting with a letter or a
 * digit. No `.`, so `.` and `..` cannot appear; no `%`, so nothing is encoded;
 * no `:`, `@`, `\`, `?`, `#` or white space.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Sign-in pages themselves, and the handler that ends a session. Returning to
 * one after signing in would either show the form again or, for the handler,
 * clear the session that had just been issued. Listed for the reader: none of
 * them is an application area, so the allow-list below refuses them already.
 */
const AUTHENTICATION_SEGMENTS: ReadonlySet<string> = new Set([
  'login',
  SESSION_ENDED_SEGMENT,
  'forgot-password',
  'reset-password',
  'activate-account',
]);

/** The first segment of every workspace screen, every console screen, and the profile. */
function applicationAreas(): ReadonlySet<string> {
  const areas = new Set<string>(['profile', 'platform']);
  for (const item of flattenNavigation(NAVIGATION)) {
    // An ungated entry is a development tool (the design gallery), never a
    // screen of the product, and the root is the landing itself.
    if (item.permission === null || item.href === '/') continue;
    const first = item.href.split('/')[1];
    if (first) areas.add(first);
  }
  for (const segment of AUTHENTICATION_SEGMENTS) areas.delete(segment);
  return areas;
}

const APPLICATION_AREAS = applicationAreas();

/**
 * The intended path, if it is one this application may carry; otherwise null.
 *
 * Syntax only — it knows nothing of the session. The workspace root (`/en`)
 * is null too: it is the landing, which sign-in decides on its own.
 */
export function safeIntendedPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > INTENDED_PATH_MAX_LENGTH) return null;
  if (!raw.startsWith('/')) return null;

  const segments = raw.slice(1).split('/');
  const [locale, area] = segments;
  if (locale === undefined || !isLocale(locale)) return null;
  if (area === undefined) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;
  if (!APPLICATION_AREAS.has(area)) return null;
  return raw;
}

/** Whether a (safe) intended path is a screen of the Platform Owner Console. */
export function isPlatformPath(path: string): boolean {
  return path.split('/')[2] === 'platform';
}

/** The intended path under the locale the operator signed in with. */
export function localisedIntendedPath(path: string, locale: Locale): string {
  const [, , ...rest] = path.split('/');
  return `/${locale}/${rest.join('/')}`;
}

/**
 * Whether a session holding `permissions` may be sent to `path`.
 *
 * The rule is the sidebar's. The MOST SPECIFIC entry of the navigation that
 * contains the path is found in the whole model first, and the path is allowed
 * only when that entry — not a broader parent that happens to be visible — is
 * one the session's navigation offers. `/inventory/transfers` is therefore
 * judged by the transfers entry, never by the inventory overview above it. A
 * path no entry contains is refused, except the signed-in account's own
 * profile, which every session opens.
 *
 * `surface` names the navigation that judges: the workspace's for a tenant
 * session, the console's for a platform session. A console path is never a
 * workspace destination and the reverse, so each surface refuses the other's.
 */
export function permitsIntendedPath(
  path: string,
  permissions: readonly string[],
  surface: 'workspace' | 'console' = 'workspace'
): boolean {
  const locale = path.split('/')[1] ?? '';
  if (!isLocale(locale)) return false;
  if (isPlatformPath(path) !== (surface === 'console')) return false;
  if (surface === 'workspace' && path.split('/')[2] === 'profile') return true;
  const groups: readonly NavigationGroup[] =
    surface === 'console' ? PLATFORM_NAVIGATION : NAVIGATION;

  const candidates = flattenNavigation(groups).filter(
    (item) =>
      item.permission !== null &&
      item.href !== '/' &&
      item.status === 'available' &&
      isActive(path, locale, item)
  );
  if (candidates.length === 0) return false;
  const longest = Math.max(...candidates.map((item) => item.href.length));
  const mostSpecific = new Set(
    candidates.filter((item) => item.href.length === longest).map((item) => item.key)
  );

  const offered = flattenNavigation(visibleNavigation(groups, { permissions }));
  return offered.some((item) => mostSpecific.has(item.key));
}

/**
 * The sign-in address for a reason, carrying the intended path when there is a
 * safe one. The reason is a fixed word; the path is re-checked here so no
 * caller can put an unchecked value into the address.
 */
export function signInPath(locale: Locale, reason: string, intended: unknown = null): string {
  const safe = safeIntendedPath(intended);
  const base = `/${locale}/login?reason=${reason}`;
  return safe === null ? base : `${base}&${INTENDED_PATH_PARAM}=${encodeURIComponent(safe)}`;
}

/** The session-ended handler's address, carrying the intended path when there is a safe one. */
export function sessionEndedPath(locale: Locale, intended: unknown = null): string {
  const safe = safeIntendedPath(intended);
  const base = `/${locale}/${SESSION_ENDED_SEGMENT}`;
  return safe === null ? base : `${base}?${INTENDED_PATH_PARAM}=${encodeURIComponent(safe)}`;
}
