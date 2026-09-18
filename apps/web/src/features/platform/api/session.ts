import { redirect } from 'next/navigation';
import type { ApiClient } from '@/lib/api/client';
import { authorizedClient } from '@/lib/api/server-client';
import type { Locale } from '@/i18n/config';
import { SESSION_ENDED_SEGMENT } from '@/features/authentication/api/session-ended';

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
  if (state.problem === 'expired') redirect(`/${locale}/${SESSION_ENDED_SEGMENT}`);
  if (state.problem === 'signed-out') redirect(`/${locale}/login?reason=signed-out`);
  redirect(`/${locale}/login?reason=forbidden`);
}

/**
 * Where a successful sign-in lands, decided on the server with the new token.
 *
 * A tenant operator whose own session read succeeds goes to the workspace, as
 * before. Only when that read fails and the platform session succeeds does the
 * sign-in go to the console. Anything else keeps today's destination, where the
 * workspace layout explains the problem.
 */
export async function destinationAfterSignIn(client: ApiClient, locale: Locale): Promise<string> {
  const tenant = await client.get<unknown>(TENANT_SESSION_PATH, { retries: 0 });
  if (tenant.ok) return `/${locale}`;
  const platform = await readPlatformSession(client);
  return platform.ok ? `/${locale}/platform` : `/${locale}`;
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
