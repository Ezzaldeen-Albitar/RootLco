/**
 * The Content Security Policy.
 *
 * ## Why a nonce and not `'unsafe-inline'`
 *
 * Next's App Router emits inline bootstrap scripts — the streaming payload and
 * the hydration entry point — and there is no build-time hash for them because
 * their content depends on the render. So a policy has exactly three options:
 *
 *   1. `'unsafe-inline'` on `script-src`. This disables the protection entirely:
 *      an injected `<script>` executes, which is the attack a CSP exists to stop.
 *   2. A per-request **nonce**. Next reads the nonce from the CSP header it
 *      receives and stamps it on its own script tags; an injected script has no
 *      nonce and does not run.
 *   3. No CSP at all, which is honest but worse.
 *
 * We use the nonce, generated per request in `src/proxy.ts`. **P1-25-F-022 is the record of getting this wrong first**:
 * the initial policy shipped `script-src 'self'` with no nonce, which blocked
 * Next's own bootstrap and broke every page. The browser smoke caught it because
 * it asserts an empty console — a screenshot would have shown a blank page and
 * a human might have blamed the build.
 *
 * ## The cost, stated plainly
 *
 * A nonce is per-request, so the pages that carry one are rendered per request
 * rather than prerendered. That is a real trade: static delivery for a policy
 * that actually holds. It is the right trade here because every operational
 * screen in P1-26 onward is authenticated and dynamic anyway, and a prerendered
 * page with a disabled CSP would be fast and unprotected.
 *
 * ## Why NOT `'strict-dynamic'`
 *
 * It was tried and removed. `'strict-dynamic'` disables host-based allowlisting,
 * so `'self'` stops applying and every `<script src>` chunk in the emitted HTML
 * needs its own nonce — which Next does not do; it nonces inline scripts only.
 * The result was a page whose inline bootstrap ran and whose chunks were all
 * blocked, which is a blank screen rather than a partial one.
 *
 * Plain `'self'` plus the nonce is the working shape and loses nothing here:
 * there is no CDN and no third-party script origin, so a host allowlist of
 * exactly one origin is as tight as `'strict-dynamic'` would have been.
 *
 * ## `connect-src` and the client-diagnostics sink (`P1-27-DO-002`)
 *
 * This module is the ONLY place `connect-src` is assembled. `next.config.ts`
 * does have a `headers()` block, and it deliberately carries no CSP — it says
 * so, and a static header would be overwritten by the proxy in any case — so
 * this is also the only place an outbound destination can be admitted.
 *
 * `installConfiguredMonitoringAdapter` delivers with `navigator.sendBeacon`,
 * which the browser governs by `connect-src`. Until this option existed, the
 * policy named `'self'` and the API origin and nothing else, so a deployment
 * that set `NEXT_PUBLIC_CLIENT_MONITORING_URL` to a cross-origin sink got a
 * beacon the browser refused — and both docblocks that described the switch
 * instructed the reader to add the origin to "`connect-src` in `src/proxy.ts`",
 * a file that holds no such value and cannot: `contentSecurityPolicy` took no
 * parameter for it. The documented way to switch the feature on did not work.
 *
 * The remedy is (a) of the two on offer: make it work, rather than write the
 * limitation down. It is available because the sink URL reaches this builder by
 * exactly the mechanism the API origin already uses — `process.env` read in
 * `src/proxy.ts` and passed in — so nothing new has to be true for it to hold.
 * Three constraints on it, each asserted in `tests/security.test.ts`:
 *
 *   - **Origin only.** A `connect-src` source is scheme/host/port; a path is
 *     meaningless there and a sink URL has one (`https://sink.test/events`), so
 *     the path is discarded rather than emitted as a source nothing matches.
 *   - **Validated, and fails closed.** Anything that is not an `http(s)` URL is
 *     dropped, not interpolated. A value that reached the header unchecked
 *     would let a mis-set variable widen the policy, which is the opposite of
 *     what a policy is for.
 *   - **Unset changes nothing.** With no sink configured the header is byte
 *     identical to what it was before this option existed.
 */

export interface CspOptions {
  /** Per-request nonce, base64. Omitted only when building a policy for a test. */
  readonly nonce?: string | undefined;
  /** The API origin the client is allowed to call. */
  readonly apiOrigin?: string | undefined;
  /**
   * Development mode ONLY. React's dev tooling reconstructs call stacks with
   * `eval()`, so the strict policy floods the dev console with a benign but
   * alarming error ("React will never use eval() in production mode"). The
   * concession is scoped to this flag, the flag is set from NODE_ENV in one
   * place (src/proxy.ts), and the test suite proves the DEFAULT policy never
   * carries it — a production page cannot receive it.
   */
  readonly dev?: boolean | undefined;
  /**
   * The client-diagnostics sink, as the FULL URL a deployment configured in
   * `NEXT_PUBLIC_CLIENT_MONITORING_URL` — the same value `client-log.ts` beacons
   * to. Only its ORIGIN is used; see `connectSourceOrigin`. Omitted or invalid
   * leaves `connect-src` exactly as it would have been.
   */
  readonly monitoringUrl?: string | undefined;
}

/**
 * The `connect-src` source for a configured URL, or `null` if there is none.
 *
 * Returns the origin — scheme, host, port — and discards the path, because that
 * is what a source expression matches; `https://sink.test/events` as a source
 * would match nothing.
 *
 * `null` for anything that is not an absolute `http`/`https` URL. That covers
 * an unset variable, a typo, and the case worth naming: a `javascript:` or
 * `data:` value, whose `URL.origin` is the string `"null"` and which must never
 * be pasted into a policy. Dropping rather than throwing is deliberate — this
 * runs in the proxy on every request, and a throw there is a blank site, so a
 * misconfigured sink degrades to "no beacon" rather than "no application".
 */
export function connectSourceOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.origin;
}

export function contentSecurityPolicy({
  nonce,
  apiOrigin,
  dev,
  monitoringUrl,
}: CspOptions = {}): string {
  // The sink origin joins the API origin here and nowhere else. De-duplicated,
  // because a deployment whose sink is its own API would otherwise name the
  // same origin twice in one directive.
  const connect = [
    ...new Set(["'self'", apiOrigin, connectSourceOrigin(monitoringUrl)].filter(Boolean)),
  ].join(' ');
  // NO 'strict-dynamic'. It disables host allowlisting, which would require
  // every <script src> chunk to carry its own nonce — and Next stamps the nonce
  // on inline scripts only. With plain 'self', same-origin chunks load because
  // they are same-origin, and inline scripts still need the nonce. The
  // protection that matters is unchanged: an injected inline script has no
  // nonce, and an injected remote script is not same-origin.
  const script = ["'self'", nonce ? `'nonce-${nonce}'` : null, dev ? "'unsafe-eval'" : null]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    // No 'unsafe-eval' and no 'unsafe-inline'. See the module note.
    `script-src ${script}`,
    // The ONE concession, and it is on styles: Next injects inline <style> for
    // critical CSS and offers no way to nonce it in the App Router. A style
    // injection cannot execute.
    "style-src 'self' 'unsafe-inline'",
    // `data:` for the inlined SVG icons; no remote image host is approved.
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Header the middleware passes to the render so components can read the nonce. */
export const NONCE_HEADER = 'x-nonce';
