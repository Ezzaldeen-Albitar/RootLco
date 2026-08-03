'use server';

import { redirect } from 'next/navigation';
import { anonymousClient } from '@/lib/api/server-client';
import { writeSession, writeTenantHint } from '@/lib/api/session-cookie';
import { env } from '@/lib/env';
import { fromFailure, invalid, type ActionState } from '@/lib/forms/action-result';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/config';
import { issueKeysByField, loginSchema } from '../schemas/credentials';

/**
 * Sign in.
 *
 * ## Everything that could distinguish one failure from another is removed
 *
 * The backend answers wrong password, unknown address, unknown tenant, an
 * account that is `invited`, `locked` or `archived`, a disabled provider
 * identity and a tenant mismatch with **one** code and one message, deliberately
 * (`authentication-service.ts` §1). It would be trivially easy to undo that here
 * — a friendlier "no account with that address", a different message for a
 * locked account — and each one would hand an attacker an oracle.
 *
 * So this maps every backend failure to a single message key, and the only thing
 * that varies is the correlation ID.
 *
 * The one exception is `rate-limited`, which is not a credential verdict: it is
 * the same answer for every address, it tells an attacker nothing they did not
 * cause themselves, and hiding it would leave an operator staring at a wrong-
 * password message while the real problem is that they must wait.
 *
 * ## What is never written anywhere
 *
 * The password. Not to a log, not to a returned state, not to a field error. The
 * access token goes straight into a `httpOnly` cookie and is never returned to
 * the caller.
 */

const LOGIN_PATH = '/api/v1/auth/login';

interface LoginResponse {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly tenantId: string;
  };
}

export async function loginAction(previous: ActionState, form: FormData): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;
  const locale = localeFrom(form.get('locale'));

  const parsed = loginSchema.safeParse({
    tenantId: String(form.get('tenantId') ?? ''),
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
  });
  if (!parsed.success) {
    return invalid(issueKeysByField(parsed.error), attempt, 'auth.login.error.invalid');
  }

  const result = await anonymousClient().send<LoginResponse>('POST', LOGIN_PATH, parsed.data);

  if (!result.ok) {
    if (result.kind === 'rate-limited') {
      return fromFailure(result, attempt, 'auth.login.error.throttled');
    }
    if (result.kind === 'unavailable' || result.kind === 'timeout' || result.kind === 'network') {
      return fromFailure(result, attempt, 'auth.login.error.unavailable');
    }
    // Everything else — 401, 403, 404, 422, 500 — is one answer. A caller
    // learns that sign-in did not succeed, and nothing else.
    return {
      status: 'error',
      messageKey: 'auth.login.error.failed',
      correlationId: result.correlationId,
      attempt,
    };
  }

  if (!isLoginShape(result.data)) {
    // A 200 that is not the contract's shape is an outage, not a sign-in. Never
    // write a cookie from a response we could not read.
    return {
      status: 'unavailable',
      messageKey: 'auth.login.error.unavailable',
      correlationId: result.correlationId,
      attempt,
    };
  }

  await writeSession(result.data.accessToken, result.data.expiresAt, env.NEXT_PUBLIC_APP_ENV);
  await writeTenantHint(parsed.data.tenantId, env.NEXT_PUBLIC_APP_ENV);

  // A redirect, not a rendered dashboard. It replaces the sign-in entry in
  // history, so Back after signing in does not return to a form that is now
  // pointless — and it starts a fresh server render, which is what resolves the
  // session and its scope.
  redirect(`/${locale}`);
}

function localeFrom(value: FormDataEntryValue | null): Locale {
  const candidate = typeof value === 'string' ? value : '';
  return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
}

function isLoginShape(value: unknown): value is LoginResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.accessToken === 'string' && typeof candidate.expiresAt === 'string';
}
