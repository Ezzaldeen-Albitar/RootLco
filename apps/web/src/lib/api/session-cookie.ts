import { cookies } from 'next/headers';

/**
 * Where the session lives, and the one place its rules are written down.
 *
 * ## Why a cookie and not a store
 *
 * The backend is bearer-authenticated. Something has to hold the access token
 * between requests, and every option was weighed against one question: what can
 * a script on the page read?
 *
 *   - `localStorage`, `sessionStorage`, IndexedDB, a persisted Zustand slice —
 *     all readable by any script that executes in the document. One cross-site
 *     scripting defect anywhere in the application becomes a stolen session.
 *   - A `httpOnly` cookie is **not readable by page script at all**. The browser
 *     attaches it; the document never sees it. That is what the "no tokens in
 *     browser storage" rule is actually protecting against, and this satisfies
 *     it rather than working around it.
 *
 * `sameSite: 'lax'` so a cross-site POST cannot carry it — every mutation in
 * this application is a POST through a Server Action, so `lax` costs nothing and
 * removes the cross-site request forgery class outright. `secure` everywhere
 * except a plain-HTTP local runtime, where a secure cookie would simply never be
 * stored and login would appear to succeed and then fail.
 *
 * ## What is NOT in here
 *
 * No refresh token. `POST /api/v1/auth/login` returns one, and RootLco has no
 * approved refresh operation — there is no `/auth/refresh` in the route tree —
 * so storing it would be storing a credential nothing can spend. It is dropped
 * on the floor, deliberately, and `known-limitations.md` records that session
 * lifetime is therefore the access token's lifetime.
 *
 * No tenant, company, branch, permission set or display name. Every one of those
 * is resolved server-side per request by `GET /api/v1/auth/session`. A copy in a
 * cookie would be a second source of truth that the client could edit.
 */

/** Namespaced so it cannot collide with the shell's UI-preference keys. */
export const SESSION_COOKIE = 'rootlco.session';

/** Tenant identifier, remembered ONLY to pre-fill the login field. */
export const TENANT_HINT_COOKIE = 'rootlco.tenantHint';

export interface SessionCookieAttributes {
  readonly httpOnly: boolean;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: string;
}

/**
 * The attributes every session write uses.
 *
 * Exported as a pure function of the environment so a test can assert the
 * production shape without running in production — a security attribute that is
 * only correct in an environment the test suite never enters is not verified.
 */
export function sessionCookieAttributes(appEnv: string): SessionCookieAttributes {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // A `secure` cookie is silently discarded over plain HTTP. The local
    // runtime is http://127.0.0.1, so forcing it there would break sign-in in
    // the one environment a developer uses to notice it is broken.
    //
    // It FAILS CLOSED: only the exact string `local` turns it off. An empty
    // value, an unset variable, a typo, or a value this function has never heard
    // of all produce a secure cookie. The earlier form derived the same result
    // from a schema whose DEFAULT was `local` — so a deployment that forgot to
    // set `NEXT_PUBLIC_APP_ENV` served the session over plain HTTP and nothing
    // reported it (finding `P1-26-F-023`). A security attribute whose safe state
    // depends on a variable being present is not a control.
    secure: appEnv !== 'local',
    path: '/',
  };
}

/** Reads the access token, or null when there is no session. */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}

/** Reads the remembered tenant identifier, for pre-filling the login form. */
export async function readTenantHint(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(TENANT_HINT_COOKIE)?.value;
  return value && UUID.test(value) ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Writes the session.
 *
 * `expiresAt` comes from the backend's own response, so the cookie stops being
 * sent at the moment the token stops being accepted. A cookie that outlives its
 * token produces a request that is rejected instead of a redirect to sign in,
 * which reads to the operator as a broken screen rather than an expired session.
 */
export async function writeSession(
  token: string,
  expiresAt: string,
  appEnv: string
): Promise<void> {
  const store = await cookies();
  const expires = new Date(expiresAt);
  store.set(SESSION_COOKIE, token, {
    ...sessionCookieAttributes(appEnv),
    ...(Number.isNaN(expires.getTime()) ? {} : { expires }),
  });
}

/**
 * Remembers the tenant identifier so the next sign-in does not have to retype
 * it. Deliberately NOT `httpOnly` — it is pre-fill convenience, it authorises
 * nothing, and the login service treats it as a lookup key that a caller may
 * already guess. It is still validated as a UUID on read so a tampered value
 * cannot reach a form field as arbitrary text.
 */
export async function writeTenantHint(tenantId: string, appEnv: string): Promise<void> {
  if (!UUID.test(tenantId)) return;
  const store = await cookies();
  store.set(TENANT_HINT_COOKIE, tenantId, {
    httpOnly: false,
    sameSite: 'lax',
    secure: appEnv !== 'local',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
}

/**
 * Clears the session.
 *
 * Called on sign-out, on an expired session, and on any 401 from a
 * server-rendered read. Clearing on 401 is what stops the redirect loop: a
 * cookie that is present but rejected would otherwise send the operator to the
 * dashboard, back to sign-in, and around again.
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
