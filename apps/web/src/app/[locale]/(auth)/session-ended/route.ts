import { notFound, redirect } from 'next/navigation';
import { INTENDED_PATH_PARAM, signInPath } from '@/features/authentication/api/intended-path';
import { mayEndSession } from '@/features/authentication/api/session-ended';
import { isLocale } from '@/i18n/config';
import { clearSession } from '@/lib/api/session-cookie';

/**
 * Drops a rejected session, then sends the operator to sign in.
 *
 * `requireSession` redirects here when the backend answered 401. It cannot clear
 * the cookie itself — a Server Component render may not write one, and doing it
 * anyway answered HTTP 500 to every expired session (`P1-26-F-063`). A Route
 * Handler may, so the clearing happens here and the visible destination is
 * unchanged: `/{locale}/login?reason=expired`.
 *
 * This is the same `clearSession()` sign-out calls, so the cookie's name and
 * attributes still live in exactly one file and this handler owns none of them.
 *
 * There is no destination parameter, deliberately — the target is built from the
 * validated locale and a literal. A handler that clears a credential and then
 * forwards wherever the query string says is an open redirect on the
 * authentication flow, which `check-p1-26-frontend.mjs` forbids by name.
 *
 * What it does carry is the page the operator was opening (P1-32-PRE-OD-AUTHB),
 * and only as a parameter of the sign-in address — this handler never goes
 * there. `signInPath` re-checks it against the application-path allow-list
 * (`intended-path.ts`); anything else is dropped and the operator lands on the
 * same `?reason=expired` as before. Sign-in follows it only after the new
 * session proves it may open the page.
 */
export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  if (mayEndSession(request.headers.get('sec-fetch-site'))) {
    await clearSession();
  }

  const intended = new URL(request.url).searchParams.get(INTENDED_PATH_PARAM);
  redirect(signInPath(locale, 'expired', intended));
}
