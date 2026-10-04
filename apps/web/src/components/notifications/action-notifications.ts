import type { ToastTone } from '@/components/overlays/Overlays';
import type { ActionState } from '@/lib/forms/action-result';
import type { Messages } from '@/i18n/get-messages';
import { explanationFor, translate, translateWithValues } from '@/i18n/get-messages';
import { notify } from './notification-store';

/**
 * The one mapping from an operation result to a notification.
 *
 * It exists so every screen answers the same way. Four administration screens
 * each deciding for themselves whether a conflict is a warning or an error is
 * four chances to be inconsistent, and the operator is the one who has to
 * reconcile them.
 *
 * ## Which results become a toast, and which do not
 *
 * `invalid` is deliberately absent. Invalid input belongs beside the field the
 * operator has to correct, not in a corner of the viewport they then have to
 * translate back into "which box was wrong" — that is the rule in §6, and it is
 * enforced here by returning null rather than by asking each caller to remember.
 *
 * `idle` is absent for the obvious reason: nothing happened.
 */
const TONE_BY_STATUS: Partial<Record<ActionState['status'], ToastTone>> = {
  success: 'success',
  conflict: 'warning',
  throttled: 'warning',
  denied: 'error',
  expired: 'error',
  unavailable: 'error',
  error: 'error',
};

/**
 * Raises the notification an operation result deserves, if any.
 *
 * Returns true when something was raised, so a caller can tell "reported" from
 * "deliberately silent" instead of assuming.
 */
export function notifyActionResult(state: ActionState, messages: Messages): boolean {
  const tone = TONE_BY_STATUS[state.status];
  if (!tone) return false;

  // The key is a KEY. A server-authored sentence must never reach a toast: it
  // would arrive untranslated in Arabic and would bypass the catalogue
  // completeness gate entirely.
  const title = state.messageKey
    ? translateWithValues(messages, state.messageKey, state.messageValues)
    : translate(messages, tone === 'success' ? 'action.succeeded' : 'action.failed');

  // The toast's supporting line, in the order a reader needs it: what to do
  // about the refusal first, then the reference to quote if it persists.
  //
  // A heading key carries no next step — a refused permission arrives here as
  // `state.denied.title`, which is a label. The card had nowhere to put one, so
  // the whole notification was four words. The correlation ID keeps its old
  // rule: only on a failure, because printing it after a success is noise.
  const explanation =
    tone === 'success' || state.messageKey === undefined
      ? null
      : explanationFor(messages, state.messageKey);
  const reference =
    tone === 'success' || !state.correlationId
      ? null
      : `${translate(messages, 'action.reference')} ${state.correlationId}`;
  const supporting = [explanation, reference].filter((part) => part !== null).join(' ');

  notify({
    tone,
    title,
    description: supporting.length > 0 ? supporting : undefined,
  });
  return true;
}
