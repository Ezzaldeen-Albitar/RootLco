'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { FormPasswordField } from '@/components/forms/mui/FormPasswordField';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import { completePasswordResetAction } from '../actions/password-reset';
import { MuiFormFeedback } from './MuiFormFeedback';
import { MuiSubmitButton, useSubmitOnce } from './MuiSubmitButton';

/**
 * Set a password with a recovery token, on Material UI (ADR-022).
 *
 * Shared by password reset and account activation because it is one backend
 * operation reached from two links; only the surrounding words differ.
 *
 * ## The token
 *
 * Arrives as a prop, from the page, which read it from the URL the invitation or
 * reset mail produced. It is carried in a hidden field so it reaches the action
 * with the form, and it is:
 *
 *   - never written to a cookie or to browser storage;
 *   - never logged;
 *   - never echoed back in a state, an error, or a field value;
 *   - never re-serialised into a URL by this application.
 *
 * The page it lands on is not linked from anywhere and is not indexed. What this
 * component must not do is make the token *travel* any further than the request
 * that spends it.
 *
 * ## One answer for a link that cannot be spent
 *
 * Expired, invalid and already used are one sentence ("This link has expired or
 * has already been used"), because the backend does not tell them apart and a
 * page that guessed would be telling a stranger something about the link. The
 * way forward under it is the same for all three: request a new link.
 */
export function SetPasswordForm({
  locale,
  messages,
  token,
  submitLabelKey,
  doneTitleKey,
  doneBodyKey,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly token: string;
  readonly submitLabelKey: string;
  readonly doneTitleKey: string;
  readonly doneBodyKey: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    completePasswordResetAction,
    IDLE
  );
  /*
   * Both boxes are controlled and CLEARED on the attempt a refusal answers:
   * every refusal here is a statement about the value itself (too short, not
   * accepted, the two do not match), so putting the refused value back would
   * invite the operator to send it again unchanged. Recorded in
   * `CLEARS_ON_REFUSAL` in `form-reset-class.test.ts`.
   */
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [answered, setAnswered] = useState(state.attempt ?? 0);
  if ((state.attempt ?? 0) !== answered) {
    setAnswered(state.attempt ?? 0);
    setPassword('');
    setConfirmPassword('');
  }

  const { edited, errorKey, formRef } = useActionRefusal(state);
  useSubmitOnce(formRef, state, pending);

  if (state.status === 'success') {
    return (
      <div className="flex flex-col gap-4">
        <Alert severity="success" variant="outlined" role="status" data-testid="set-password-done">
          <AlertTitle component="p" className="text-body font-medium text-text-primary">
            {translateDynamic(messages, doneTitleKey)}
          </AlertTitle>
          <p className="text-supporting text-text-secondary">
            {translateDynamic(messages, doneBodyKey)}
          </p>
        </Alert>
        {/*
          A link, not an automatic redirect. The confirmation says what happens
          to other sign-ins; bouncing the reader off it before they have read
          that turns a security-relevant statement into a flicker.
        */}
        <Link
          href={`/${locale}/login`}
          className="text-supporting text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'auth.reset.continue')}
        </Link>
      </div>
    );
  }

  const fieldError = (name: string) => {
    const key = errorKey(name);
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />

      <MuiFormFeedback state={state} messages={messages} />

      {/*
        Both fields carry their own reveal control, inside the field. Choosing a
        password you cannot see and then confirming a password you cannot see is
        how a typo becomes an account you are locked out of — and this form is
        reached from an invitation or a reset link, where the operator has no
        working password to fall back on.
      */}
      <FormPasswordField
        name="password"
        label={translate(messages, 'auth.reset.password')}
        description={translate(messages, 'auth.reset.passwordHint')}
        required
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={setPassword}
        onEdit={() => edited('password')}
        error={fieldError('password')}
        showLabel={translate(messages, 'field.password.show')}
        hideLabel={translate(messages, 'field.password.hide')}
      />

      <FormPasswordField
        name="confirmPassword"
        label={translate(messages, 'auth.reset.confirmPassword')}
        required
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        onEdit={() => edited('confirmPassword')}
        error={fieldError('confirmPassword')}
        showLabel={translate(messages, 'field.password.show')}
        hideLabel={translate(messages, 'field.password.hide')}
      />

      <MuiSubmitButton
        label={translateDynamic(messages, submitLabelKey)}
        pendingLabel={translate(messages, 'auth.reset.submitting')}
      />

      <Link
        href={`/${locale}/forgot-password`}
        className="text-supporting text-primary underline-offset-2 hover:underline"
      >
        {translate(messages, 'auth.reset.requestAnother')}
      </Link>
    </form>
  );
}
