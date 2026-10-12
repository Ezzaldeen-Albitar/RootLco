'use client';

import Alert from '@mui/material/Alert';
import type { Messages } from '@/i18n/get-messages';
import { explanationFor, translate, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

/**
 * `FormFeedback` on Material UI — the one banner an authentication or account
 * form uses to report its action's outcome. Same catalogue entries, same rules:
 *
 *   - **`status` for a success, `alert` for a failure.** A polite announcement
 *     for "saved" and an assertive one for "that did not work". Material's
 *     `Alert` would otherwise interrupt for both.
 *   - **Keyed on the attempt**, so submitting the same wrong password twice
 *     renders a fresh node and the second refusal is announced as well.
 *   - **No `problem.detail`, no raw code.** Only a translated key, its
 *     explanation line when the key names a heading (`explanationFor`, the
 *     pairing `FailureExplanation` decides for the legacy banner), and the
 *     correlation reference.
 *   - **One answer for every credential failure** is the action's decision;
 *     this draws the sentence it chose and nothing else.
 *
 * `FormFeedback` stays: the screens that have not moved still render it.
 */
export function MuiFormFeedback({
  state,
  messages,
}: {
  readonly state: ActionState;
  readonly messages: Messages;
}) {
  if (state.status === 'idle' || !state.messageKey) return null;

  const success = state.status === 'success';
  const severity = success
    ? 'success'
    : state.status === 'conflict' || state.status === 'throttled'
      ? 'warning'
      : 'error';
  const explanation = explanationFor(messages, state.messageKey);

  return (
    <Alert
      key={`${state.status}-${state.attempt ?? 0}`}
      severity={severity}
      variant="outlined"
      role={success ? 'status' : 'alert'}
      data-testid="form-feedback"
      data-state={state.status}
      className="w-full"
    >
      <p>
        {translateWithValues(messages, state.messageKey, state.messageValues)}
        {explanation === null ? null : (
          <span className="mt-1 block font-normal">{explanation}</span>
        )}
      </p>
      {state.correlationId ? (
        <p className="mt-1 text-caption text-text-muted">
          {translate(messages, 'state.correlationId')}{' '}
          <code className="font-mono text-text-secondary">{state.correlationId}</code>
        </p>
      ) : null}
    </Alert>
  );
}
