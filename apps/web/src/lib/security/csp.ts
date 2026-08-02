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
}

export function contentSecurityPolicy({ nonce, apiOrigin, dev }: CspOptions = {}): string {
  const connect = ["'self'", apiOrigin].filter(Boolean).join(' ');
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
