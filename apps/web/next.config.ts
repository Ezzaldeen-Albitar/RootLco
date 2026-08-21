import type { NextConfig } from 'next';

/**
 * Web application configuration.
 *
 * `apps/web` is one half of the npm workspace; `apps/api` is the other. They
 * share a lockfile and a dependency-security authority and nothing else — see
 * docs/phase-1/phase-1-25/ for the architecture record.
 */

/**
 * The build directory, isolated per runtime mode — `P1-26-F-055`.
 *
 * `next dev`, `next build` and `next start` all default to `apps/web/.next`, and
 * the development server and the production server keep incompatible manifests
 * there. Running one after the other in the same checkout leaves the second one
 * reading the first one's output.
 *
 * That is not theoretical. It took the local stack down mid-suite, and then it
 * manufactured a defect that did not exist: with a production build left in
 * `.next`, `next dev` answered **404** on nested administration routes while
 * `/administration` answered 307. The routes were correct; the directory was
 * contaminated. Half an hour went into diagnosing a phantom, and a code change
 * was very nearly shipped for it.
 *
 * The launcher now sets `ROOTLCO_DIST_DIR=.next-dev`, so development and
 * production never share a directory and neither can be corrupted by the other.
 * The default is unchanged, so `next build`, `next start`, Docker, the browser
 * suite and CI all behave exactly as before.
 */
const distDir = process.env.ROOTLCO_DIST_DIR ?? '.next';

const nextConfig: NextConfig = {
  distDir,
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
