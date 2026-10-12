'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormPasswordField } from '@/components/forms/mui/FormPasswordField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import { loginAction } from '../actions/login';
import { INTENDED_PATH_PARAM } from '../api/intended-path';
import { MuiFormFeedback } from './MuiFormFeedback';
import { MuiSubmitButton, useSubmitOnce } from './MuiSubmitButton';
import { usePrefilledValue } from './use-prefilled-value';

/**
 * The sign-in form, on Material UI (ADR-022).
 *
 * ## Nothing about a failure varies
 *
 * The backend answers every credential failure identically, and this preserves
 * that: one banner, one sentence, no per-field "no account with that address".
 * The only per-field errors shown are the ones the action produced before the
 * request left — a blank password, an address that is not one — which describe
 * the operator's own typing and disclose nothing about what exists. The cursor
 * goes to the first of them (`useActionRefusal`), and editing a field withdraws
 * the complaint about it.
 *
 * ## Still a Server Action form
 *
 * `<form action={…}>`, so the sign-in works before the page has hydrated, the
 * action decides the redirect (workspace or console) and replaces the sign-in
 * entry in history, and Enter in either box submits. `useSubmitOnce` holds a
 * second press until the first is answered.
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
  intendedPath = null,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * The page sign-in was asked for on the way to, already checked by the page
   * against the application-path allow-list. The action checks it again and
   * follows it only when the new session may open it (P1-32-PRE-OD-AUTHB).
   */
  readonly intendedPath?: string | null;
}) {
  /*
   * Both boxes are controlled, so React's reset of the form after the action
   * settles cannot empty them by itself. The address is RETAINED across a
   * refusal; the password is cleared on purpose, on the attempt the refusal
   * answers — the decision is recorded in `CLEARS_ON_REFUSAL` in
   * `form-reset-class.test.ts`.
   */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, formAction, pending] = useActionState<ActionState, FormData>(loginAction, IDLE);
  const [answered, setAnswered] = useState(state.attempt ?? 0);
  if ((state.attempt ?? 0) !== answered) {
    setAnswered(state.attempt ?? 0);
    setPassword('');
  }

  const { edited, errorKey, formRef } = useActionRefusal(state);
  useSubmitOnce(formRef, state, pending);
  /*
   * A sign-in form is the one a browser or a password manager fills in by
   * itself, and it is drawn before the page has hydrated. What a box already
   * holds as the form mounts is adopted into the state, so no later render
   * writes an empty box over it — typing the password does not erase a filled
   * address, and revealing a filled password does not erase it.
   */
  usePrefilledValue(formRef, 'email', email, setEmail);
  usePrefilledValue(formRef, 'password', password, setPassword);
  const fieldError = (name: string) => {
    const key = errorKey(name);
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {intendedPath ? (
        <input type="hidden" name={INTENDED_PATH_PARAM} value={intendedPath} />
      ) : null}

      <MuiFormFeedback state={state} messages={messages} />

      <FormTextField
        name="email"
        type="email"
        label={translate(messages, 'auth.login.email')}
        required
        autoComplete="username"
        spellCheck={false}
        value={email}
        onChange={setEmail}
        onEdit={() => edited('email')}
        error={fieldError('email')}
      />

      {/*
        The reveal control lives INSIDE the field (`FormPasswordField`), as the
        Product Owner asked at acceptance: a control below the input reads as an
        action on the form rather than part of the field. It defaults to hidden,
        and `autoComplete` stays `current-password` in both modes.
      */}
      <FormPasswordField
        name="password"
        label={translate(messages, 'auth.login.password')}
        required
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        onEdit={() => edited('password')}
        error={fieldError('password')}
        showLabel={translate(messages, 'field.password.show')}
        hideLabel={translate(messages, 'field.password.hide')}
      />

      <MuiSubmitButton
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
