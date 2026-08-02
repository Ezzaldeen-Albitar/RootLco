import { NextResponse, type NextRequest } from 'next/server';
import { NONCE_HEADER, contentSecurityPolicy } from '@/lib/security/csp';

/**
 * Per-request Content Security Policy nonce.
 *
 * Next reads the nonce out of the CSP header it receives here and stamps it on
 * its own inline bootstrap scripts. An injected `<script>` carries no nonce and
 * does not execute — see `src/lib/security/csp.ts` for why this is a nonce
 * rather than `'unsafe-inline'`.
 *
 * The matcher deliberately excludes static assets. A hashed chunk under
 * `/_next/static` is immutable and cacheable, and running middleware on it would
 * give every asset a unique header for no benefit while defeating the CDN.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const csp = contentSecurityPolicy({
    nonce,
    ...(process.env.NEXT_PUBLIC_API_BASE_URL
      ? { apiOrigin: process.env.NEXT_PUBLIC_API_BASE_URL }
      : {}),
  });

  // The header must reach BOTH the render and the browser: Next reads it from
  // the request to find the nonce, and the browser needs it on the response to
  // enforce anything at all. Setting only one of the two is the quiet failure —
  // the page renders correctly and is completely unprotected.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
