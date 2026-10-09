'use client';

import { useActionState, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import { requestPasswordResetAction } from '../actions/password-reset';
import { MuiFormFeedback } from './MuiFormFeedback';
import { MuiSubmitButton, useSubmitOnce } from './MuiSubmitButton';

/**
 * Request a password-reset link, on Material UI (ADR-022).
 *
 * On success the form is REPLACED by the confirmation rather than left on screen
 * beneath it. Leaving a submit button under a "check your email" message invites
 * a second request that the rate limiter will refuse, and the operator reads the
 * refusal as the reset having failed.
 *
 * The confirmation never says whether an account exists. That is not a UX
 * compromise — it is the whole point of the operation, which answers identically
 * for every address by design: the action turns every refusal other than a
 * throttle or an outage into this same confirmation.
 */
export function ForgotPasswordForm({ messages }: { readonly messages: Messages }) {
  /*
   * Controlled, so the address survives React's reset of the form after a
   * refused submit.
   */
  const [email, setEmail] = useState('');
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    requestPasswordResetAction,
    IDLE
  );
  const { edited, errorKey, formRef } = useActionRefusal(state);
  useSubmitOnce(formRef, state, pending);

  if (state.status === 'success') {
    return (
      <Alert severity="success" variant="outlined" role="status" data-testid="forgot-submitted">
        <AlertTitle component="p" className="text-body font-medium text-text-primary">
          {translate(messages, 'auth.forgot.submitted')}
        </AlertTitle>
        <p className="text-supporting text-text-secondary">
          {translate(messages, 'auth.forgot.submittedDetail')}
        </p>
      </Alert>
    );
  }

  const fieldError = errorKey('email');

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5" noValidate>
      <MuiFormFeedback state={state} messages={messages} />
      <FormTextField
        name="email"
        type="email"
        label={translate(messages, 'auth.forgot.email')}
        required
        autoComplete="username"
        spellCheck={false}
        value={email}
        onChange={setEmail}
        onEdit={() => edited('email')}
        error={fieldError ? translateDynamic(messages, fieldError) : undefined}
      />
      <MuiSubmitButton
        label={translate(messages, 'auth.forgot.submit')}
        pendingLabel={translate(messages, 'auth.forgot.submitting')}
      />
    </form>
  );
}
