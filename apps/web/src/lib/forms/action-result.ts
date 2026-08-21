import { failureMessageKey, violationKeysOf, type ApiFailure } from '@/lib/api/client';

/**
 * What a Server Action gives back to a form.
 *
 * One shape for every form in the phase, because the alternative is twenty
 * slightly different shapes and twenty slightly different renderings of the same
 * six outcomes.
 *
 * ## What a result may carry
 *
 * Translation **keys**, and nothing else that came from the backend. The
 * correlation ID is the one diagnostic that is safe to show — it is an opaque
 * token that finds the server-side log without telling the browser anything.
 *
 * Field errors are NOT an exception to that, and this paragraph used to say they
 * were. It read: "only the field paths the backend published in
 * `problem.errors`, mapped to the form's own controls." **`problem.errors` does
 * not exist and never has.** The API publishes `violations` — a list of
 * `{ path, rule }` pairs carrying no prose at all — so there is no backend
 * message for a field to display even if this module wanted one. `violationKeysOf`
 * turns each violation into a catalogue key; a rule the catalogue does not carry
 * becomes `form.violation.invalid`. Every value in `fieldErrors` is therefore a
 * key, full stop.
 *
 * ## A violation about the whole request is not dropped
 *
 * `{ path: 'body', rule: 'empty_patch' }` — a save with nothing changed — names
 * no control. Mapping it to a control would invent one; ignoring it would leave
 * the operator staring at a form that refuses with no reason given, which is
 * what happened before. It becomes the `messageKey` instead, so it appears in
 * the banner every form in this phase already renders. That keeps ONE shape: no
 * new field, nothing for a screen to forget to render.
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
  /**
   * Translation keys, by control name.
   *
   * Not "translation keys OR backend field messages", which is what this said.
   * The ambiguity was the defect rather than a description of it: a renderer
   * cannot know which of two things it has been handed, so it must guess, and
   * two renderers guessing differently is a bug waiting for the first backend
   * message to arrive. There is exactly one possibility. A value here is always
   * a catalogue key.
   *
   * Every render site in the application already assumes that and translates —
   * `RecordForm.tsx:169`, `RolesScreen.tsx:194,200`, `UsersScreen.tsx:429,436`,
   * `CustomerProfileScreen.tsx:417-419`, `CustomerCreateScreen.tsx:409` and the
   * vehicle screens. They were right and this sentence was wrong.
   */
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
 *
 * ## Precedence of the banner key, and why it is that order
 *
 * 1. `messageKeyOverride`, when a caller passed one. It wins over everything,
 *    because the reason it exists is to REMOVE information; a whole-request
 *    violation leaking past it would reopen the oracle it closes.
 * 2. The first whole-request violation key, when the backend sent one. `body` +
 *    `empty_patch` says something specific and true that the generic banner does
 *    not.
 * 3. The generic key for the failure kind.
 *
 * First rather than all, matching the per-control rule, because the banner is
 * one line.
 */
export function fromFailure(
  failure: ApiFailure,
  attempt: number,
  messageKeyOverride?: string
): ActionState {
  const status = STATUS_BY_KIND[failure.kind];
  const { fieldErrors, formKeys } = violationKeysOf(failure);
  return {
    status,
    messageKey: messageKeyOverride ?? formKeys[0] ?? failureMessageKey(failure),
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
