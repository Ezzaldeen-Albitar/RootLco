import type { ToastTone } from '@/components/overlays/Overlays';
import type { ActionState } from '@/lib/forms/action-result';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
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
    ? translate(messages, state.messageKey as keyof Messages)
    : translate(messages, tone === 'success' ? 'action.succeeded' : 'action.failed');

  notify({
    tone,
    title,
    // The correlation ID is the only diagnostic a user ever sees, and it is the
    // one thing worth carrying into a support conversation. It is shown only on
    // a failure — printing it after a success is noise.
    description:
      tone === 'success' || !state.correlationId
        ? undefined
        : `${translate(messages, 'action.reference')} ${state.correlationId}`,
  });
  return true;
}
