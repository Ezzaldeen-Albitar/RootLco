'use server';

import { redirect } from 'next/navigation';
import { clientWithToken } from '@/lib/api/server-client';
import { clearSession, readSessionToken } from '@/lib/api/session-cookie';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/config';

/**
 * Sign out.
 *
 * ## The local cookie is cleared first, and unconditionally
 *
 * The backend call ends the server-side session, which is what actually revokes
 * anything. But if it fails — the API is down, the network dropped — the
 * operator has still pressed Sign out, and leaving a usable token in their
 * browser because a remote call failed is the wrong way round. So: clear first,
 * then tell the backend, then redirect regardless.
 *
 * `POST /api/v1/auth/logout` is idempotent by construction (revoking an already
 * revoked session affects zero rows and that is success), so a retry from a
 * second tab, or from a user pressing the button twice, is not an error.
 *
 * The token has to be read BEFORE the cookie is cleared — it is the only
 * authority the logout operation accepts, and it identifies exactly the one
 * session being ended.
 */

const LOGOUT_PATH = '/api/v1/auth/logout';

export async function logoutAction(form: FormData): Promise<void> {
  const locale = localeFrom(form.get('locale'));
  const token = await readSessionToken();

  await clearSession();

  if (token) {
    // The result is not inspected. The local session is already gone, and there
    // is no user-facing outcome that would differ: sign-out has happened from
    // the operator's point of view either way. The backend logs its own failure
    // with the correlation ID.
    await clientWithToken(token).send('POST', LOGOUT_PATH);
  }

  redirect(`/${locale}/login?reason=signed-out`);
}

function localeFrom(value: FormDataEntryValue | null): Locale {
  const candidate = typeof value === 'string' ? value : '';
  return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
}
