'use client';

import { useActionState } from 'react';
import { TextField } from '@/components/forms/Field';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { requestPasswordResetAction } from '../actions/password-reset';
import { FormFeedback } from './FormFeedback';
import { SubmitButton } from './SubmitButton';

/**
 * Request a password-reset link.
 *
 * On success the form is REPLACED by the confirmation rather than left on screen
 * beneath it. Leaving a submit button under a "check your email" message invites
 * a second request that the rate limiter will refuse, and the operator reads the
 * refusal as the reset having failed.
 *
 * The confirmation never says whether an account exists. That is not a UX
 * compromise — it is the whole point of the operation, which answers identically
 * for every address by design.
 */
export function ForgotPasswordForm({ messages }: { readonly messages: Messages }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    requestPasswordResetAction,
    IDLE
  );

  if (state.status === 'success') {
    return (
      <div
        role="status"
        className="rounded-lg border border-success-border bg-success-subtle p-4"
      >
        <p className="text-body font-medium text-text-primary">
          {translate(messages, 'auth.forgot.submitted')}
        </p>
        <p className="mt-1 text-supporting text-text-secondary">
          {translate(messages, 'auth.forgot.submittedDetail')}
        </p>
      </div>
    );
  }

  const fieldError = state.fieldErrors?.email;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormFeedback state={state} messages={messages} />
      <TextField
        name="email"
        type="email"
        label={translate(messages, 'auth.forgot.email')}
        required
        autoComplete="username"
        spellCheck={false}
        error={fieldError ? translate(messages, fieldError as keyof Messages) : undefined}
      />
      <SubmitButton
        label={translate(messages, 'auth.forgot.submit')}
        pendingLabel={translate(messages, 'auth.forgot.submitting')}
      />
    </form>
  );
}
