import type { NextConfig } from 'next';

/**
 * Web application configuration.
 *
 * `apps/web` is one half of the npm workspace; `apps/api` is the other. They
 * share a lockfile and a dependency-security authority and nothing else — see
 * docs/phase-1/phase-1-25/ for the architecture record.
 */

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
          // The CSP is NOT here: it carries a per-request nonce and therefore
          // lives in src/proxy.ts (Next 16's name for middleware). A static CSP
          // header would be overwritten by the proxy anyway, and having two
          // sources for one policy is how they drift.
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
