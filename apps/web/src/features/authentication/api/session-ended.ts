/**
 * Ending a rejected session, from a context that is allowed to.
 *
 * ## Why a Route Handler exists at all
 *
 * A token the backend has rejected should not stay in the browser, and the
 * obvious place to drop it — the function that just read the 401 — is the one
 * place that cannot. `readSession` runs inside a Server Component render, and
 * Next forbids cookie mutation there; doing it anyway threw
 * `Cookies can only be modified in a Server Action or Route Handler` and turned
 * every protected route into an HTTP 500 for the operator whose session had just
 * expired (`P1-26-F-077`).
 *
 * Next names the two contexts that MAY write a cookie in that error message.
 * A Server Action is unreachable from a render, so this is the other one: a
 * Route Handler that clears the cookie and forwards to sign-in. `requireSession`
 * redirects here instead of clearing, and the operator still lands on
 * `/{locale}/login?reason=expired` — the extra hop is invisible.
 *
 * The constant lives here rather than in the handler because `route.ts` may
 * export only HTTP methods and Next's route config; a second copy of the path
 * inside `requireSession` would be free to drift from the directory that serves
 * it. `tests/session.test.ts` asserts the directory named here really exists.
 */

/** The path segment under `/{locale}` that serves the handler. */
export const SESSION_ENDED_SEGMENT = 'session-ended';

/**
 * Whether a request is allowed to end the session.
 *
 * Clearing a cookie on `GET` is reachable cross-site — `<img src=".../en/
 * session-ended">` on any page would sign the operator out. Sign-out proper is a
 * `POST` Server Action and carries Next's own forgery protection; this handler
 * has to earn the equivalent, and `Sec-Fetch-Site` is what browsers already send
 * to answer exactly this question.
 *
 * `same-origin` is our own redirect and our own router. `none` is the address
 * bar, a bookmark or a typed URL. Everything else — `cross-site`, and
 * `same-site`, which is a different origin on a sibling subdomain — is somebody
 * else's page choosing the moment, and gets the redirect without the clearing.
 *
 * **A missing header clears.** The header is absent only for callers that are
 * not browsers, and a request forgery needs a browser to carry the victim's
 * cookie — so absence is not the attack, and treating it as one would mean the
 * clearing quietly stopped happening for every non-browser caller, including the
 * runtime checks that prove it happens at all. Every browser that can mount the
 * attack has sent this header since 2020.
 */
export function mayEndSession(secFetchSite: string | null): boolean {
  if (secFetchSite === null) return true;
  return secFetchSite === 'same-origin' || secFetchSite === 'none';
}
