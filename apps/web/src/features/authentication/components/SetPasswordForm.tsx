'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { completePasswordResetAction } from '../actions/password-reset';
import { FormFeedback } from './FormFeedback';
import { SubmitButton } from './SubmitButton';

/**
 * Set a password with a recovery token.
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
  const [state, formAction] = useActionState<ActionState, FormData>(
    completePasswordResetAction,
    IDLE
  );

  if (state.status === 'success') {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="status"
          className="rounded-lg border border-success-border bg-success-subtle p-4"
        >
          <p className="text-body font-medium text-text-primary">
            {translate(messages, doneTitleKey as keyof Messages)}
          </p>
          <p className="mt-1 text-supporting text-text-secondary">
            {translate(messages, doneBodyKey as keyof Messages)}
          </p>
        </div>
        {/*
          A link, not an automatic redirect. The confirmation says other sessions
          were ended; bouncing the reader off it before they have read that turns
          a security-relevant statement into a flicker.
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
    const key = state.fieldErrors?.[name];
    return key ? translate(messages, key as keyof Messages) : undefined;
  };

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />

      <FormFeedback state={state} messages={messages} />

      <TextField
        name="password"
        type="password"
        label={translate(messages, 'auth.reset.password')}
        description={translate(messages, 'auth.reset.passwordHint')}
        required
        autoComplete="new-password"
        minLength={8}
        error={fieldError('password')}
      />

      <TextField
        name="confirmPassword"
        type="password"
        label={translate(messages, 'auth.reset.confirmPassword')}
        required
        autoComplete="new-password"
        error={fieldError('confirmPassword')}
      />

      <SubmitButton
        label={translate(messages, submitLabelKey as keyof Messages)}
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
