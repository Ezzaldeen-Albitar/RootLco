import { z } from 'zod';

/**
 * Client-side validation of the authentication forms.
 *
 * ## What this is for, and what it is not
 *
 * It is for telling an operator that a field is empty before a round trip. It is
 * **not** access control and it is not the credential policy — the backend
 * bounds passwords in `CredentialPolicy` and the identity provider decides
 * strength (ADR-019). Scoring a password here would create a second answer to
 * "is this acceptable", and the two would drift.
 *
 * Every bound below is copied from a published contract, and the contract is
 * named beside it, so a divergence is a visible edit rather than a discovery.
 */

/**
 * Bounds from `CredentialPolicy.assertPasswordBounds` — 8 to 200 characters.
 *
 * Mirrored rather than guessed so the form can say "too short" without a round
 * trip. If the backend tightens it, the backend still wins: the server's
 * `ERR-VAL-001` is surfaced, and this only ever stops a request that could not
 * have succeeded.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** `email: z.string().min(3).max(320)` on the login and reset contracts. */
export const EMAIL_MIN = 3;
export const EMAIL_MAX = 320;

/**
 * The login form.
 *
 * **Two fields.** There is no tenant here and there must not be one: the tenant
 * is resolved server-side from the identity the provider verifies, because
 * `POST /api/v1/auth/login` no longer requires it (`P1-26-F-068`). Asking a
 * person to type a UUID was never a product; it was a contract leaking through
 * the interface.
 *
 * Reintroducing it would mean either hard-coding a tenant here or shipping a
 * directory of tenants to an unauthenticated page — and the second is an
 * enumeration oracle handed out at the door.
 *
 * The password is bounded only at 1 here, not at 8: an existing account may
 * predate any bound, and refusing to *submit* a short password would tell the
 * operator their own stored credential is invalid when the truth is that it is
 * simply wrong or the account is not active. Sign-in validates presence; only
 * password *creation* validates strength bounds.
 */
export const loginSchema = z.object({
  // EVERY bound carries a message key. A `.max()` with no message emits Zod's
  // own English sentence, which reaches an Arabic screen untranslated and
  // bypasses the catalogue completeness test entirely (P1-26-F-033).
  email: z
    .string()
    .trim()
    .min(EMAIL_MIN, 'auth.login.error.email')
    .max(EMAIL_MAX, 'auth.login.error.emailLength'),
  password: z
    .string()
    .min(1, 'auth.login.error.password')
    .max(PASSWORD_MAX, 'auth.login.error.passwordLength'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * The forgot-password form.
 *
 * One field. No tenant, because the contract has none: the reset request is
 * deliberately incurious and answers identically for every address. Asking for a
 * tenant here would imply the answer depends on it.
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(EMAIL_MIN, 'auth.forgot.error.email')
    .max(EMAIL_MAX, 'auth.login.error.emailLength'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Setting a password with a recovery token.
 *
 * Shared by password reset and account activation, because they are the same
 * backend operation — `POST /api/v1/auth/password-reset/completion` — reached
 * from two different links. Duplicating the schema would let the two drift.
 *
 * `confirmPassword` exists only here, on the client. It is a typing safeguard
 * for a value the operator cannot see and cannot recover if mistyped; the
 * backend has no such field and none is sent.
 */
export const setPasswordSchema = z
  .object({
    token: z.string().min(8, 'auth.reset.error.token').max(2048, 'auth.reset.error.token'),
    password: z
      .string()
      .min(PASSWORD_MIN, 'auth.reset.error.passwordLength')
      .max(PASSWORD_MAX, 'auth.reset.error.passwordLength'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.reset.error.mismatch',
  });

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/**
 * The first message key a parse produced, or null.
 *
 * Returns a translation KEY, never a sentence: the schema is shared by two
 * locales and a hard-coded English message would be a translation gap that
 * ships.
 */
export function firstIssueKey(error: z.ZodError): string | null {
  const issue = error.issues[0];
  return issue ? issue.message : null;
}

/** Field-keyed message keys, for wiring a form's per-field errors. */
export function issueKeysByField(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in out)) out[field] = issue.message;
  }
  return out;
}
