'use client';

import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

/**
 * The one banner every form uses to report an action's outcome.
 *
 * ## Why it is a live region, and why the key includes the attempt
 *
 * A validation failure that appears after submit is announced only if it lands
 * inside a region the screen reader is already watching. `role="alert"` does
 * that — but React reconciles by position, so submitting the same wrong password
 * twice renders an identical node and the second failure is announced to nobody.
 * Keying on the attempt number forces a fresh node, so every submission is
 * reported.
 *
 * ## What it will not render
 *
 * `problem.detail`. It is server-authored text that can name an internal path, a
 * table or a constraint, and this is precisely the element a user screenshots
 * into a support ticket. Only a translated key, and the correlation ID.
 */
export function FormFeedback({
  state,
  messages,
}: {
  readonly state: ActionState;
  readonly messages: Messages;
}) {
  if (state.status === 'idle' || !state.messageKey) return null;

  const success = state.status === 'success';
  const tone = success
    ? 'border-success-border bg-success-subtle'
    : state.status === 'conflict' || state.status === 'throttled'
      ? 'border-warning-border bg-warning-subtle'
      : 'border-error-border bg-error-subtle';

  return (
    <div
      key={`${state.status}-${state.attempt ?? 0}`}
      // `status` for a success, `alert` for a failure. A polite announcement for
      // "saved" and an assertive one for "that did not work" is the difference
      // between confirming and interrupting, and both are wrong the other way
      // round.
      role={success ? 'status' : 'alert'}
      className={`rounded-lg border p-3 text-supporting text-text-primary ${tone}`}
    >
      <p>{translate(messages, state.messageKey as keyof Messages)}</p>
      {state.correlationId ? (
        <p className="mt-1 text-caption text-text-muted">
          {translate(messages, 'state.correlationId')}{' '}
          <code className="font-mono text-text-secondary">{state.correlationId}</code>
        </p>
      ) : null}
    </div>
  );
}
