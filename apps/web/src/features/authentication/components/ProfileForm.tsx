'use client';

import { useActionState, useState } from 'react';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { IDLE, type ActionState } from '@/lib/forms/action-result';
import { useActionRefusal } from '@/lib/forms/use-action-refusal';
import { useEditBaseline } from '@/lib/forms/use-edit-baseline';
import { updateOwnProfileAction } from '../actions/profile';
import { MuiFormFeedback } from './MuiFormFeedback';
import { MuiSubmitButton, useSubmitOnce } from './MuiSubmitButton';

/**
 * The one editable part of a profile, on Material UI (ADR-022).
 *
 * `recordVersion` travels in a hidden field so the `If-Match` guard uses the
 * version the operator was actually looking at — the edit's BASELINE version
 * (`useEditBaseline`), never a newer one a refresh brought while the name was
 * being typed. It is not a secret and not a capability: changing it can only
 * cause the update to be refused as a conflict, never to succeed against a
 * record the actor may not touch.
 *
 * A typed name that differs from the saved one is unsaved work: leaving the page
 * by a link, back or forward, or a reload asks first (`useUnsavedGuard`), and a
 * save that succeeds re-bases the form so nothing asks afterwards.
 */
interface ProfileValues {
  readonly displayName: string;
}

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
   * Seeded from the saved display name and then owned by the draft: a refused
   * save keeps what was typed rather than restoring the SERVER value, which
   * would read as the edit having been silently reverted. Controlled, so React's
   * reset of the form after the action settles cannot empty it.
   */
  const edit = useEditBaseline<ProfileValues>({
    stored: { displayName },
    storedVersion: recordVersion,
    // The action saves the name trimmed, so a trailing space alone is nothing
    // to save and nothing to lose.
    differs: (values, baseline) => values.displayName.trim() !== baseline.displayName.trim(),
  });
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateOwnProfileAction,
    IDLE
  );

  /*
   * A save the server confirmed re-bases the form on what was written, once per
   * attempt; the refresh the action asks for (`revalidatePath`) then brings the
   * new version while the form is clean.
   */
  const [answered, setAnswered] = useState(state.attempt ?? 0);
  if ((state.attempt ?? 0) !== answered) {
    setAnswered(state.attempt ?? 0);
    if (state.status === 'success') edit.rebase(edit.values);
  }

  useUnsavedGuard(edit.dirty, () => edit.discard());

  // Question f: the cursor goes to the refused name, and the complaint goes once
  // it is edited (route sweep B3).
  const { edited, errorKey, formRef } = useActionRefusal(state);
  useSubmitOnce(formRef, state, pending);
  const error = errorKey('displayName');

  return (
    <form ref={formRef} action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="recordVersion" value={edit.version} />

      <MuiFormFeedback state={state} messages={messages} />

      <FormTextField
        name="displayName"
        label={translate(messages, 'profile.displayName')}
        value={edit.values.displayName}
        onChange={(value) => edit.setValues({ displayName: value })}
        onEdit={() => edited('displayName')}
        required
        autoComplete="name"
        error={error ? translateDynamic(messages, error) : undefined}
      />

      <div>
        <MuiSubmitButton
          label={translate(messages, 'profile.save')}
          pendingLabel={translate(messages, 'admin.saving')}
          full={false}
        />
      </div>
    </form>
  );
}
