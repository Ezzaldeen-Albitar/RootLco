'use server';

import { anonymousClient } from '@/lib/api/server-client';
import { fromFailure, invalid, success, type ActionState } from '@/lib/forms/action-result';
import {
  forgotPasswordSchema,
  issueKeysByField,
  setPasswordSchema,
} from '../schemas/credentials';

/**
 * Requesting a password reset, and completing one.
 *
 * ## The request answers the same way every time
 *
 * `POST /api/v1/auth/password-reset` returns 202 whether or not the address is
 * known — it does not look the address up locally and writes no row. The
 * interface must preserve that: a "we could not find that address" would turn
 * the form into an address-enumeration oracle, and a *faster* answer for an
 * unknown address would do it by stopwatch.
 *
 * So this returns the SAME success state for every outcome the backend can
 * report except two: a rate-limit, which the operator caused and needs to know
 * about, and an outage, which is not a verdict about their address at all. Both
 * of those are identical for every address, so neither leaks anything.
 *
 * ## The token is never logged, never stored, never echoed
 *
 * It arrives in the completion form, goes into the request body, and is gone. It
 * is not written to a cookie, not put in a URL this application constructs, and
 * not returned in any state — including in a validation error, which is the
 * quiet way a credential ends up in a log index.
 *
 * `redirectTo` is deliberately NOT sent. The backend matches it **exactly**
 * against a configured allow-list and falls back to the first entry when it is
 * absent; the web tier does not hold that allow-list, so any value it invented
 * would either be rejected or, worse, accepted after someone widened the list to
 * make the form work.
 */

const RESET_REQUEST_PATH = '/api/v1/auth/password-reset';
const RESET_COMPLETION_PATH = '/api/v1/auth/password-reset/completion';

export async function requestPasswordResetAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = forgotPasswordSchema.safeParse({ email: String(form.get('email') ?? '') });
  if (!parsed.success) {
    return invalid(issueKeysByField(parsed.error), attempt, 'auth.forgot.error.invalid');
  }

  const result = await anonymousClient().send('POST', RESET_REQUEST_PATH, {
    email: parsed.data.email,
  });

  if (!result.ok) {
    if (result.kind === 'rate-limited') {
      return fromFailure(result, attempt, 'auth.forgot.error.throttled');
    }
    if (result.kind === 'unavailable' || result.kind === 'timeout' || result.kind === 'network') {
      return fromFailure(result, attempt, 'auth.forgot.error.unavailable');
    }
    // Any other failure is answered as success. The backend already refuses to
    // say whether the address exists; reporting a 4xx here would say it for it.
    return success('auth.forgot.submitted', attempt);
  }

  return success('auth.forgot.submitted', attempt);
}

/**
 * Completing a reset, or setting a password on an invited account.
 *
 * One action for both, because it is one backend operation reached from two
 * links. An expired, invalid or already-used token all produce the same backend
 * failure, and all three are shown as one message with a route back to
 * requesting a new link — which is the only useful next step in every case.
 */
export async function completePasswordResetAction(
  previous: ActionState,
  form: FormData
): Promise<ActionState> {
  const attempt = (previous.attempt ?? 0) + 1;

  const parsed = setPasswordSchema.safeParse({
    token: String(form.get('token') ?? ''),
    password: String(form.get('password') ?? ''),
    confirmPassword: String(form.get('confirmPassword') ?? ''),
  });
  if (!parsed.success) {
    return invalid(issueKeysByField(parsed.error), attempt, 'auth.reset.error.invalid');
  }

  const result = await anonymousClient().send('POST', RESET_COMPLETION_PATH, {
    token: parsed.data.token,
    password: parsed.data.password,
  });

  if (!result.ok) {
    if (result.kind === 'rate-limited') {
      return fromFailure(result, attempt, 'auth.reset.error.throttled');
    }
    if (result.kind === 'unavailable' || result.kind === 'timeout' || result.kind === 'network') {
      return fromFailure(result, attempt, 'auth.reset.error.unavailable');
    }
    // Expired, invalid, already used, or refused by the provider's own strength
    // policy. The backend does not distinguish the first three and the fourth
    // arrives as a validation failure; both roads lead to "ask for a new link".
    return {
      status: result.kind === 'validation' ? 'invalid' : 'error',
      messageKey:
        result.kind === 'validation' ? 'auth.reset.error.rejected' : 'auth.reset.error.token',
      correlationId: result.correlationId,
      attempt,
    };
  }

  return success('auth.reset.done', attempt);
}
