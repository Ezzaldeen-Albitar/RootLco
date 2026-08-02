import type { NextConfig } from 'next';

/**
 * Web application configuration.
 *
 * `apps/web` is one half of the npm workspace; `apps/api` is the other. They
 * share a lockfile and a dependency-security authority and nothing else — see
 * docs/phase-1/phase-1-25/ for the architecture record.
 */

/**
 * Content Security Policy.
 *
 * Written as a list so each decision carries its reason, because a CSP is
 * exactly the kind of string that gets loosened once under deadline and never
 * tightened again.
 *
 * `'unsafe-inline'` on `style-src` is the one concession, and it is Next's
 * requirement rather than ours: the framework injects inline `<style>` elements
 * for critical CSS and there is no supported way to nonce them in the App
 * Router today. It is scoped to styles alone — a style injection cannot execute.
 *
 * `'unsafe-eval'` is NOT present and must not be added. It is the single
 * difference between a CSP that stops an injected script and one that does not.
 *
 * `connect-src` is deliberately narrow: `'self'` plus the configured API origin.
 * A wildcard here would let an injected script exfiltrate to any host it liked,
 * which is the whole attack a CSP is supposed to interrupt.
 */
function contentSecurityPolicy(): string {
  const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const connect = ["'self'", apiOrigin].filter(Boolean).join(' ');

  return [
    "default-src 'self'",
    // No 'unsafe-eval', and no 'unsafe-inline' for scripts.
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // `data:` for the inlined SVG icons; no remote image host is approved yet.
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    // The application is never framed and frames nothing.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // Forms post to the API through the client, never to a third party.
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  sassOptions: {
    // Silences the deprecation noise from Sass's legacy JS API inside Next's
    // pipeline without suppressing warnings from our own stylesheets.
    quietDeps: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Redundant with `frame-ancestors` for modern browsers, kept for the
          // ones that do not implement it.
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
export { contentSecurityPolicy };
