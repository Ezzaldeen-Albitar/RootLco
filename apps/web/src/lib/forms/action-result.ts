import { FAILURE_MESSAGE_KEY, fieldErrorsOf, type ApiFailure } from '@/lib/api/client';

/**
 * What a Server Action gives back to a form.
 *
 * One shape for every form in the phase, because the alternative is twenty
 * slightly different shapes and twenty slightly different renderings of the same
 * six outcomes.
 *
 * ## What a result may carry
 *
 * A translation **key**, never server-authored prose. `problem.detail` is
 * written by the backend and can name an internal path, a table, or a
 * constraint; putting it on screen is how an internal detail reaches a
 * screenshot in a support ticket. The correlation ID is the one diagnostic that
 * is safe to show — it is an opaque token that finds the server-side log without
 * telling the browser anything.
 *
 * Field errors are the exception, and they are bounded: only the field paths the
 * backend published in `problem.errors`, mapped to the form's own controls.
 */

export type ActionStatus =
  | 'idle'
  | 'success'
  /** Input the operator can correct. Field errors are populated. */
  | 'invalid'
  /** A conflict: someone else changed the record first. */
  | 'conflict'
  /** The backend refused. Never explains what was missing. */
  | 'denied'
  /** The session ended mid-action. */
  | 'expired'
  /** Throttled by the backend's rate-limit policy. */
  | 'throttled'
  /** The backend could not be reached, timed out, or failed. */
  | 'unavailable'
  /** Anything else the backend reported. */
  | 'error';

export interface ActionState {
  readonly status: ActionStatus;
  /** A translation key. Never a server-authored sentence. */
  readonly messageKey?: string;
  /** Per-field translation keys or backend field messages, by control name. */
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** Safe to display. The only diagnostic a user ever sees. */
  readonly correlationId?: string | null;
  /**
   * Bumped on every submission so a form can re-announce an identical result.
   *
   * Without it, submitting the same wrong password twice produces two identical
   * state objects, React sees no change in the value a live region renders, and
   * the second failure is announced to nobody.
   */
  readonly attempt?: number;
}

export const IDLE: ActionState = Object.freeze({ status: 'idle' });

const STATUS_BY_KIND: Record<ApiFailure['kind'], ActionStatus> = {
  unauthenticated: 'expired',
  forbidden: 'denied',
  'not-found': 'error',
  conflict: 'conflict',
  validation: 'invalid',
  'rate-limited': 'throttled',
  server: 'error',
  unavailable: 'unavailable',
  timeout: 'unavailable',
  cancelled: 'error',
  network: 'unavailable',
};

/**
 * Maps a client failure onto an action state.
 *
 * `messageKeyOverride` exists for the operations whose failure must be
 * deliberately uninformative — sign-in above all, where every distinguishable
 * failure would be an account and tenant enumeration oracle. The backend already
 * answers all of them with one code; this makes sure the interface does not
 * helpfully undo that.
 */
export function fromFailure(
  failure: ApiFailure,
  attempt: number,
  messageKeyOverride?: string
): ActionState {
  const status = STATUS_BY_KIND[failure.kind];
  const fieldErrors = fieldErrorsOf(failure);
  return {
    status,
    messageKey: messageKeyOverride ?? FAILURE_MESSAGE_KEY[failure.kind],
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    correlationId: failure.correlationId,
    attempt,
  };
}

export function invalid(
  fieldErrors: Readonly<Record<string, string>>,
  attempt: number,
  messageKey = 'form.formError'
): ActionState {
  return { status: 'invalid', messageKey, fieldErrors, attempt };
}

export function success(messageKey: string, attempt: number): ActionState {
  return { status: 'success', messageKey, attempt };
}

/** Whether a state should block a second submission of the same form. */
export function isTerminalSuccess(state: ActionState): boolean {
  return state.status === 'success';
}
