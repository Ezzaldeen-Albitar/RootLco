import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle with only the dependencies actually
  // reachable at runtime. This is what the Dockerfile `runner` stage copies,
  // and it is why the production image does not need node_modules. (ADR-007)
  output: 'standalone',

  // Fail the production build on a type error rather than shipping it.
  // (Next.js 16 removed the `eslint` key from NextConfig; linting is enforced by
  // `npm run lint` and by the CI `quality` job instead.)
  typescript: { ignoreBuildErrors: false },

  // Do not advertise the framework/version.
  poweredByHeader: false,

  // Conservative baseline headers. The full security-header set (a Content
  // Security Policy in particular) is deliberately deferred: a CSP written
  // before any UI exists would be either uselessly permissive or immediately
  // broken. Recorded as an open item in
  // docs/phase-1/phase-1-1/security-readiness.md.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
