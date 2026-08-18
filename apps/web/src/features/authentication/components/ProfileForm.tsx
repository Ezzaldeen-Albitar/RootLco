'use client';

import { useActionState, useState } from 'react';
import { TextField } from '@/components/forms/Field';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { updateOwnProfileAction } from '../actions/profile';
import { FormFeedback } from './FormFeedback';
import { SubmitButton } from './SubmitButton';

/**
 * The one editable part of a profile.
 *
 * `recordVersion` travels in a hidden field so the `If-Match` guard uses the
 * version the operator was actually looking at. It is not a secret and not a
 * capability: changing it can only cause the update to be refused as a conflict,
 * never to succeed against a record the actor may not touch.
 */
export function ProfileForm({
  locale,
  messages,
  displayName,
  recordVersion,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly displayName: string;
  readonly recordVersion: number;
}) {
  /*
   * Seeded from the saved display name and then owned by the draft: without
   * it a refused save restores the SERVER value, which reads as the edit
   * having been silently reverted.
   */
  const [draftName, setDraftName] = useState(displayName);
  const [state, formAction] = useActionState<ActionState, FormData>(updateOwnProfileAction, IDLE);
  const error = state.fieldErrors?.displayName;

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="recordVersion" value={recordVersion} />

      <FormFeedback state={state} messages={messages} />

      <TextField
        key={`displayName-${state.attempt ?? 0}`}
        name="displayName"
        label={translate(messages, 'profile.displayName')}
        defaultValue={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        required
        autoComplete="name"
        error={error ? translate(messages, error as keyof Messages) : undefined}
      />

      <div>
        <SubmitButton
          label={translate(messages, 'profile.save')}
          pendingLabel={translate(messages, 'admin.saving')}
          full={false}
        />
      </div>
    </form>
  );
}
