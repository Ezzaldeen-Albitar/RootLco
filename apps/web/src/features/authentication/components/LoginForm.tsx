'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { loginAction } from '../actions/login';
import { FormFeedback } from './FormFeedback';
import { SubmitButton } from './SubmitButton';

/**
 * The sign-in form.
 *
 * ## Nothing about a failure varies
 *
 * The backend answers every credential failure identically, and this preserves
 * that: one banner, one sentence, no per-field "no account with that address".
 * The only per-field errors shown are the ones this form produced itself before
 * the request left — a blank password, a malformed workspace identifier — which
 * describe the operator's own typing and disclose nothing about what exists.
 *
 * ## Autocomplete, and why it is set
 *
 * `username` and `current-password` let a password manager fill the form, which
 * is the single most effective thing an interface can do for password hygiene.
 * `autoComplete="off"` on a sign-in form does not improve security; it pushes
 * people towards passwords they can remember.
 */
export function LoginForm({
  locale,
  messages,
  tenantHint,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly tenantHint: string | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(loginAction, IDLE);
  const fieldError = (name: string) => {
    const key = state.fieldErrors?.[name];
    return key ? translate(messages, key as keyof Messages) : undefined;
  };

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="locale" value={locale} />

      <FormFeedback state={state} messages={messages} />

      <TextField
        name="tenantId"
        label={translate(messages, 'auth.login.tenantId')}
        description={translate(messages, 'auth.login.tenantIdHint')}
        defaultValue={tenantHint ?? ''}
        required
        autoComplete="organization"
        spellCheck={false}
        error={fieldError('tenantId')}
      />

      <TextField
        name="email"
        type="email"
        label={translate(messages, 'auth.login.email')}
        required
        autoComplete="username"
        spellCheck={false}
        error={fieldError('email')}
      />

      <TextField
        name="password"
        type="password"
        label={translate(messages, 'auth.login.password')}
        required
        autoComplete="current-password"
        error={fieldError('password')}
      />

      <SubmitButton
        label={translate(messages, 'auth.login.submit')}
        pendingLabel={translate(messages, 'auth.login.submitting')}
      />

      <Link
        href={`/${locale}/forgot-password`}
        className="text-supporting text-primary underline-offset-2 hover:underline"
      >
        {translate(messages, 'auth.login.forgot')}
      </Link>
    </form>
  );
}
