import { redirect } from 'next/navigation';
import { authorizedClient } from '@/lib/api/server-client';
import type { Locale } from '@/i18n/config';
import { readPlatformSession } from '@/features/platform/api/session';
import { SESSION_ENDED_SEGMENT } from './session-ended';
import type { SessionState, SessionSummary } from '../types/session';

/**
 * Reading the session, server-side, before anything protected is rendered.
 *
 * ## This is what prevents the protected-content flash
 *
 * The alternative shape — render the page, fetch the session in the browser,
 * redirect if it fails — sends the protected markup to the browser first. It is
 * then in the DOM, in the network tab, and in any extension reading the page,
 * and hiding it afterwards changes none of that. Here the check happens before
 * a single byte of protected output exists, so there is nothing to flash.
 *
 * ## Reading a session MUTATES NOTHING
 *
 * This module used to call `clearSession()` on a 401, from inside a Server
 * Component render. Next forbids cookie mutation during a render, so the render
 * threw `Cookies can only be modified in a Server Action or Route Handler` and
 * every protected route answered **HTTP 500 to the one visitor who most needed a
 * redirect** — the operator whose session had just expired (`P1-26-F-077`). The
 * signed-out path hid it: with no cookie at all `authorizedClient()` returns
 * null and the function returns before reaching the mutation, so the ordinary
 * "not signed in" case redirected correctly and the broken one was the rarer.
 *
 * Clearing a rejected token is still right — see `session-ended.ts` — but it is
 * done by a Route Handler, which is a context Next permits to write cookies.
 */

const SESSION_PATH = '/api/v1/auth/session';

export async function readSession(): Promise<SessionState> {
  const client = await authorizedClient();
  if (!client) return { ok: false, problem: 'signed-out', correlationId: null };

  // `retries: 0`. A session read that fails is a verdict, and retrying it
  // doubles the latency of every expired session before the operator is told.
  const result = await client.get<SessionSummary>(SESSION_PATH, { retries: 0 });

  if (result.ok) {
    if (!isSessionShape(result.data)) {
      return { ok: false, problem: 'unavailable', correlationId: result.correlationId };
    }
    /*
     * An account that holds no permission code at all is answered 200 since the
     * session read became an authenticated self-read (P1-32-PRE-OD-FRX), where it
     * used to be refused 403. Nothing in the workspace is open to it, so it is
     * still `forbidden`: the sign-in page's sentence — "not permitted to open the
     * application; an administrator needs to grant it access" — is the true one,
     * the cookie is kept, and `requireSession` still asks the platform session
     * first, which is how the platform operator (no tenant role by construction)
     * keeps reaching the console. An account holding ANY code is answered, which
     * is the defect this closed: a quotations-only role used to be refused here.
     */
    if (result.data.permissions.length === 0) {
      return { ok: false, problem: 'forbidden', correlationId: result.correlationId };
    }
    return { ok: true, session: result.data };
  }

  // The token was rejected. The cookie is NOT cleared here — this runs inside a
  // render, where Next forbids it. `requireSession` sends this case through the
  // session-ended Route Handler, which clears it legally.
  if (result.kind === 'unauthenticated') {
    return { ok: false, problem: 'expired', correlationId: result.correlationId };
  }

  /*
   * A 403 is NOT an expired session, and treating it as one was a lockout.
   *
   * `GET /api/v1/auth/session` used to require `iam.user.read`. An account that
   * authenticated successfully but did not hold that permission got a 403 —
   * and clearing the cookie on it produced an unbreakable loop: sign in, receive
   * a valid cookie, load the dashboard, 403, cookie cleared, back to sign-in,
   * for ever. The operator has correct credentials and cannot get in
   * (finding `P1-26-F-022`). The read declares no code since P1-32-PRE-OD-FRX,
   * so that 403 no longer happens for a missing code; a 403 here is still kept
   * as a refusal and never treated as an ended session.
   *
   * So the cookie is KEPT — it is valid, and destroying a valid credential
   * because a permission is missing is the wrong remedy — and the sign-in page
   * says the account cannot read its own session rather than that the session
   * ended. That is a permissions problem for an administrator, and the message
   * names it.
   */
  if (result.kind === 'forbidden') {
    return { ok: false, problem: 'forbidden', correlationId: result.correlationId };
  }

  return { ok: false, problem: 'unavailable', correlationId: result.correlationId };
}

/**
 * The session, or a redirect to sign in. The only entry point protected pages
 * use, so no page can accidentally render without one.
 *
 * `redirect()` throws, which is how Next unwinds — the `never` return type is
 * what makes a caller's `const session = await requireSession(...)` correctly
 * typed as a `SessionSummary` and not as a union.
 *
 * ## Exactly one problem takes the long way round
 *
 * A REJECTED token should not stay in the jar, and only a rejected token should
 * be thrown away. So `expired` — and nothing else — goes via the session-ended
 * Route Handler, which clears the cookie and then lands on sign-in with the same
 * `reason=expired` this function would have sent directly.
 *
 * The other three go straight to sign-in with their cookie untouched, and each
 * for its own reason: `signed-out` has no cookie to clear, `unavailable` means
 * the backend could not answer and destroying a good session over a hiccup would
 * turn an outage into a re-authentication, and `forbidden` is the lockout
 * recorded below — the credential is VALID and clearing it was `P1-26-F-022`.
 */
export async function requireSession(locale: Locale): Promise<SessionSummary> {
  const state = await readSession();
  if (state.ok) return state.session;
  if (state.problem === 'expired') redirect(`/${locale}/${SESSION_ENDED_SEGMENT}`);
  // A forbidden workspace session may belong to the platform operator, who holds
  // no tenant role by construction. When the platform session answers, the
  // operator is routed to the console rather than stranded on sign-in
  // (P1-32-PRE-061). A tenant user never reaches this branch: their own session
  // read succeeds above.
  if (state.problem === 'forbidden') {
    const platform = await readPlatformSession();
    if (platform.ok) redirect(`/${locale}/platform`);
  }
  // The reason is a fixed enum, not free text and not an identifier. It changes
  // which sentence the sign-in page shows; it names no user and no record.
  redirect(`/${locale}/login?reason=${state.problem}`);
}

/**
 * A structural check on the response.
 *
 * The client already parsed JSON; this asserts it is the *shape* the contract
 * publishes. Without it a backend that answered `200` with an error envelope
 * would produce a session whose `permissions` is `undefined`, and
 * `hasPermission` would then throw inside a render instead of denying — a
 * malformed response must fail closed, not crash.
 */
function isSessionShape(value: unknown): value is SessionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.tenantId === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.displayName === 'string' &&
    Array.isArray(candidate.companyIds) &&
    Array.isArray(candidate.branchIds) &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every((entry) => typeof entry === 'string')
  );
}
