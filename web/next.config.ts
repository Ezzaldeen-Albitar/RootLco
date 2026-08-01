import type { NextConfig } from 'next';

/**
 * Frontend application configuration.
 *
 * This is an INDEPENDENT Next.js application under `web/`. It does not share a
 * package, a lockfile or a build with the root backend application — see
 * docs/phase-1/phase-1-25/frontend-architecture.md for why that boundary was
 * chosen over npm workspaces for P1-25.
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
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
