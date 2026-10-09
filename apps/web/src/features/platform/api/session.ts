import { redirect } from 'next/navigation';
import type { ApiClient } from '@/lib/api/client';
import { authorizedClient } from '@/lib/api/server-client';
import type { Locale } from '@/i18n/config';
import { landingPath } from '@/features/authentication/api/landing';
import {
  isPlatformPath,
  localisedIntendedPath,
  permitsIntendedPath,
  safeIntendedPath,
  sessionEndedPath,
  signInPath,
} from '@/features/authentication/api/intended-path';
import { requestedPath } from '@/features/authentication/api/requested-path';

/**
 * The platform operator's session, read server-side before the console renders
 * (P1-32-PRE-060).
 *
 * `GET /api/v1/auth/session` cannot describe this principal: it declares a
 * tenant permission the platform operator does not hold, so it answers 403.
 * `GET /api/v1/platform/session` is the console's own session read and carries
 * the caller's platform authority codes — and deliberately no email or name.
 *
 * Like `readSession`, reading MUTATES NOTHING: this runs inside a render, where
 * Next forbids cookie writes. An expired token is sent through the session-ended
 * Route Handler, which may clear it.
 */

export const PLATFORM_SESSION_PATH = '/api/v1/platform/session';
const TENANT_SESSION_PATH = '/api/v1/auth/session';

export interface PlatformSession {
  readonly userId: string;
  readonly homeTenantId: string;
  readonly platformPermissions: readonly string[];
}

export type PlatformSessionState =
  | { readonly ok: true; readonly session: PlatformSession }
  | {
      readonly ok: false;
      readonly problem: 'signed-out' | 'expired' | 'forbidden' | 'unavailable';
      readonly correlationId: string | null;
    };

/**
 * Reads the platform session with the given client, or with the caller's own
 * cookie when none is given. A 200 that carries no platform authority is
 * treated as forbidden: a console with nothing to offer is not a session.
 */
export async function readPlatformSession(
  client?: ApiClient | null
): Promise<PlatformSessionState> {
  const resolved = client === undefined ? await authorizedClient() : client;
  if (!resolved) return { ok: false, problem: 'signed-out', correlationId: null };

  const result = await resolved.get<PlatformSession>(PLATFORM_SESSION_PATH, { retries: 0 });
  if (result.ok) {
    if (!isPlatformSessionShape(result.data)) {
      return { ok: false, problem: 'unavailable', correlationId: result.correlationId };
    }
    if (result.data.platformPermissions.length === 0) {
      return { ok: false, problem: 'forbidden', correlationId: result.correlationId };
    }
    return { ok: true, session: result.data };
  }
  if (result.kind === 'unauthenticated') {
    return { ok: false, problem: 'expired', correlationId: result.correlationId };
  }
  if (result.kind === 'forbidden') {
    return { ok: false, problem: 'forbidden', correlationId: result.correlationId };
  }
  return { ok: false, problem: 'unavailable', correlationId: result.correlationId };
}

/**
 * The platform session, or a redirect away from the console.
 *
 * An expired token takes the session-ended route so the cookie is cleared
 * legally; a visitor with no cookie is sent to sign in; every other answer —
 * a tenant user, an operator whose authority was revoked, a backend that could
 * not answer — lands on sign-in with `reason=forbidden` and its cookie kept.
 */
export async function requirePlatformSession(locale: Locale): Promise<PlatformSession> {
  const state = await readPlatformSession();
  if (state.ok) return state.session;
  // The console page being refused travels to sign-in, re-checked at every hop,
  // so the operator returns to it (P1-32-PRE-OD-AUTHB). A refusal carries none:
  // signing in again as the same account would be refused again.
  if (state.problem === 'expired') redirect(sessionEndedPath(locale, await requestedPath()));
  if (state.problem === 'signed-out') {
    redirect(signInPath(locale, 'signed-out', await requestedPath()));
  }
  redirect(signInPath(locale, 'forbidden'));
}

/**
 * Where a successful sign-in lands, decided on the server with the new token.
 *
 * A tenant operator whose own session read succeeds goes to the workspace — to
 * the FIRST screen of the navigation their permissions open (`landingPath`),
 * which is the dashboard for anyone holding its code and the next screen they
 * can actually use for anyone who does not (Owner directive, P1-32-PRE-OD-UX).
 * A session answer that carries no readable permission list keeps the workspace
 * root, where the dashboard page applies the same rule.
 *
 * When sign-in was asked for on the way to a page (`intended`), that page wins
 * over the landing — but only when it is a safe application path AND the new
 * session's navigation offers it (`permitsIntendedPath`); a console page only
 * for a platform session, a workspace page only for a tenant one. Anything else
 * lands exactly as before (P1-32-PRE-OD-AUTHB).
 *
 * Only when the tenant read opens nothing and the platform session succeeds does
 * the sign-in go to the console. Anything else keeps today's destination, where
 * the workspace layout explains the problem.
 *
 * "Opens nothing" is a refusal or, since the session read became an authenticated
 * self-read (P1-32-PRE-OD-FRX), a 200 carrying an EMPTY permission list. The
 * platform operator holds no tenant role by construction, so its session read
 * used to answer 403 and now answers its own facts with no code; both mean the
 * workspace holds nothing for this account, and both still ask the platform.
 */
export async function destinationAfterSignIn(
  client: ApiClient,
  locale: Locale,
  intended: unknown = null
): Promise<string> {
  // Re-checked here, the one place it is followed, whatever the caller did.
  const safe = safeIntendedPath(intended);
  const wanted = safe === null ? null : localisedIntendedPath(safe, locale);

  const tenant = await client.get<unknown>(TENANT_SESSION_PATH, { retries: 0 });
  if (tenant.ok) {
    const permissions = permissionsOf(tenant.data);
    if (permissions === null) return `/${locale}`;
    if (permissions.length > 0) {
      return wanted !== null && permitsIntendedPath(wanted, permissions, 'workspace')
        ? wanted
        : landingPath(locale, permissions);
    }
    return consoleOrRoot(client, locale, wanted);
  }
  return consoleOrRoot(client, locale, wanted);
}

/**
 * The console — at the intended console page when the platform session may
 * open it — or, when the platform session does not answer, the workspace root,
 * where the workspace layout explains the refusal.
 */
async function consoleOrRoot(
  client: ApiClient,
  locale: Locale,
  wanted: string | null
): Promise<string> {
  const platform = await readPlatformSession(client);
  if (!platform.ok) return `/${locale}`;
  return wanted !== null &&
    isPlatformPath(wanted) &&
    permitsIntendedPath(wanted, platform.session.platformPermissions, 'console')
    ? wanted
    : `/${locale}/platform`;
}

/** The permission codes a tenant session answer carries, or null if it has none. */
function permissionsOf(value: unknown): readonly string[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const permissions = (value as Record<string, unknown>)['permissions'];
  return Array.isArray(permissions) && permissions.every((entry) => typeof entry === 'string')
    ? (permissions as readonly string[])
    : null;
}

function isPlatformSessionShape(value: unknown): value is PlatformSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.homeTenantId === 'string' &&
    Array.isArray(candidate.platformPermissions) &&
    candidate.platformPermissions.every((entry) => typeof entry === 'string')
  );
}
