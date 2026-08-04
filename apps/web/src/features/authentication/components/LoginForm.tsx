'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
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
 * the request left — a blank password, an address that is not one — which
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
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(loginAction, IDLE);
  const [revealed, setRevealed] = useState(false);
  const fieldError = (name: string) => {
    const key = state.fieldErrors?.[name];
    return key ? translate(messages, key as keyof Messages) : undefined;
  };

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="locale" value={locale} />

      <FormFeedback state={state} messages={messages} />

      <TextField
        name="email"
        type="email"
        label={translate(messages, 'auth.login.email')}
        required
        autoComplete="username"
        spellCheck={false}
        error={fieldError('email')}
      />

      <div className="flex flex-col gap-1.5">
        <TextField
          name="password"
          type={revealed ? 'text' : 'password'}
          label={translate(messages, 'auth.login.password')}
          required
          autoComplete="current-password"
          error={fieldError('password')}
        />
        {/*
          A toggle, not a permanent reveal, and it defaults to hidden. It exists
          because the alternative to seeing what you typed is retyping a long
          password until it works — which is the behaviour that produces short,
          memorable ones.

          `aria-pressed` carries the state, so the control announces whether the
          password is currently visible rather than only naming the action. The
          field keeps `autoComplete="current-password"` in both modes: changing
          it on reveal is what stops a password manager filling the form.
        */}
        <button
          type="button"
          onClick={() => setRevealed(!revealed)}
          aria-pressed={revealed}
          className="self-start text-caption text-text-secondary underline-offset-2 hover:text-primary hover:underline"
        >
          {translate(messages, revealed ? 'auth.login.hidePassword' : 'auth.login.showPassword')}
        </button>
      </div>

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
