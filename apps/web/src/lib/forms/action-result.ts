import {
  STATE_TRANSITION_CODE,
  VIOLATION_FALLBACK_KEY,
  controlNameFor,
  namesRouteParameter,
  refusalMessageKey,
  failureMessageValues,
  violationKeysOf,
  type ApiFailure,
} from '@/lib/api/client';

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
 *
 * A violation on a ROUTE parameter goes the same way, and for a stronger reason:
 * `{ path: 'path.batchId', rule: 'duplicate_opening_cell' }` refuses an approval
 * that sends no body at all, so there is not only no control for `batchId` —
 * there is no form. `violationKeysOf` classifies it, this banner shows it.
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
  /**
   * The caller aborted the request — a Cancel button, or leaving the screen.
   *
   * Its own status rather than `error`, because it is not one. A cancellation
   * used to arrive here as `error` with the key "Something went wrong", so an
   * operator who pressed Cancel was told the system had failed and invited to
   * try again. Nothing failed and nothing was sent to completion, so this status
   * carries no message key at all: every renderer already drops a state with no
   * key, and `notifyActionResult` raises no toast for a status with no tone.
   */
  | 'cancelled'
  /** Anything else the backend reported. */
  | 'error';

export interface ActionState {
  readonly status: ActionStatus;
  /** A translation key. Never a server-authored sentence. */
  readonly messageKey?: string;
  /**
   * Values for the `{name}` placeholders in the catalogue text of `messageKey`.
   *
   * Only numbers the backend published about the refusal itself — the capacity
   * ceiling and its usage, the wait a throttle advised — and never prose.
   * Present only when the key is the failure's own key, so an override or a
   * violation banner never receives values meant for a different sentence.
   *
   * A renderer that shows `messageKey` must pass this to `translateWithValues`.
   * Dropping it does not fall back to a shorter sentence; it prints `{limit}` or
   * `{seconds}` to the operator exactly as the catalogue spells it.
   */
  readonly messageValues?: Readonly<Record<string, string>>;
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
  /**
   * Set by `fromFailure` only, and only on a conflict whose every violation is a
   * duplicate value on a named control (see `DUPLICATE_VALUE_RULES`). It is what
   * `isFieldConflict` reads, so no other state — one that happens to share the
   * generic `form.formError` banner and carry field errors — can be taken for a
   * duplicate and lose its toast.
   */
  readonly duplicateField?: true;
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
  cancelled: 'cancelled',
  network: 'unavailable',
};

/**
 * The neutral banner a conflict about one named field carries (see `fromFailure`):
 * the form was not saved, and the field says why.
 */
export const FIELD_CONFLICT_KEY = 'form.formError';

/**
 * The violation rules that say a value is already taken by another record —
 * nothing else. `duplicate_code` is what the catalogue, intake, service
 * catalogue, price list, report configuration, warranty policy and checklist
 * template services answer for a code that is already used; `duplicate_sku` is
 * the inventory catalogue's answer for a stock code already used. A conflict
 * carrying any other rule — a stale version, a state rule, a rule the catalogue
 * does not carry — is not a duplicate and keeps its own banner and toast.
 */
export const DUPLICATE_VALUE_RULES: ReadonlySet<string> = new Set([
  'duplicate_code',
  'duplicate_sku',
]);

/**
 * Whether every violation a conflict carries is a duplicate value on a named
 * control. At least one violation is required, and one that names no control
 * (the whole request, a route parameter) or carries any other rule makes the
 * answer false, so a mix keeps the failure's own message.
 */
function isDuplicateValueConflict(failure: ApiFailure): boolean {
  if (failure.kind !== 'conflict') return false;
  const violations = failure.problem?.violations;
  if (!Array.isArray(violations) || violations.length === 0) return false;
  return violations.every(
    (violation) =>
      typeof violation?.path === 'string' &&
      typeof violation?.rule === 'string' &&
      DUPLICATE_VALUE_RULES.has(violation.rule) &&
      !namesRouteParameter(violation.path) &&
      controlNameFor(violation.path) !== null
  );
}

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
 * 2. The first whole-request violation key that SAYS something. `body` +
 *    `empty_patch` and `path.batchId` + `duplicate_opening_cell` each state a
 *    specific true reason the generic banner does not.
 * 3. The generic key for the failure kind.
 *
 * First rather than all, matching the per-control rule, because the banner is
 * one line.
 *
 * ## Why "that says something" and not simply "the first"
 *
 * A rule the catalogue does not carry becomes `form.violation.invalid` — "This
 * value is not accepted here." That is less than the kind's own banner already
 * says, so letting it win would DOWNGRADE the message: a 409 that today reads
 * "this record cannot take that change" would become the vaguer sentence, and
 * the API sends uncatalogued route-parameter rules (`grant_revoked`,
 * `not_invited`, `invitation_not_accepted`) that would do exactly that now that
 * a route parameter reaches this list at all. The fallback is skipped, not
 * dropped: it names no control either, so nothing was going to render it, and
 * the operator still gets the kind's banner.
 */
export function fromFailure(
  failure: ApiFailure,
  attempt: number,
  messageKeyOverride?: string
): ActionState {
  /*
   * A cancellation the CALLER asked for, reported as nothing.
   *
   * `#request` already separates a caller abort from the client's own deadline,
   * precisely so a user pressing Cancel is not rendered as a backend fault. That
   * distinction was then thrown away one layer up: `cancelled` mapped to
   * `error`, whose banner reads "Something went wrong" and whose page-level
   * description ends "Trying again is safe" — an apology and an invitation, for
   * an outcome the operator chose. No key is returned, so every renderer in the
   * application drops it: `FormFeedback` and `RecordForm` both require a
   * `messageKey`, and `notifyActionResult` has no tone for this status.
   *
   * An override still wins. A caller that genuinely wants to say something about
   * an abort — none does today — passes its own key and gets it.
   */
  if (failure.kind === 'cancelled' && messageKeyOverride === undefined) {
    return { status: 'cancelled', correlationId: failure.correlationId, attempt };
  }
  const status = STATUS_BY_KIND[failure.kind];
  const { fieldErrors, formKeys } = violationKeysOf(failure);
  const stated = formKeys.find((key) => key !== VIOLATION_FALLBACK_KEY);
  const own = messageKeyOverride === undefined && stated === undefined;
  /*
   * A conflict that names the FIELD it is about (P1-32-PRE-OD-INVF,
   * SETUP-cat-errors / SETUP-item-errors).
   *
   * A unique index refusing a duplicate — a category code, a stock code, a
   * location code — arrives as a conflict carrying a violation on the field
   * (`body.code` + `duplicate_code`). The field already says the true reason
   * ("This code is already used."), but the banner beside it fell through to the
   * kind's key and said "Someone else changed this", and the explanation and the
   * toast added "Reload to see the current record" — sending the operator to
   * look for a person and a reload that change nothing. So the banner says only
   * that the form could not be saved, beside the field that says why, and
   * `isFieldConflict` keeps the toast off it as for any refused input.
   *
   * The status stays `conflict`: a screen that re-reads on a conflict still
   * does. Only a conflict whose EVERY violation is a duplicate value on a named
   * control qualifies (`isDuplicateValueConflict`). A conflict that names no
   * field — a stale record version, the genuine race — one carrying any other
   * rule, and a mix of a duplicate with anything else are untouched and keep the
   * kind's sentence, its values and its toast.
   */
  const namesField =
    own && Object.keys(fieldErrors).length > 0 && isDuplicateValueConflict(failure);
  const values = own && !namesField ? failureMessageValues(failure) : undefined;
  return {
    status,
    messageKey:
      messageKeyOverride ??
      stated ??
      (namesField ? FIELD_CONFLICT_KEY : refusalMessageKey(failure)),
    ...(values !== undefined ? { messageValues: values } : {}),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    ...(namesField ? { duplicateField: true as const } : {}),
    correlationId: failure.correlationId,
    attempt,
  };
}

/**
 * `fromFailure` for an operation whose `ERR-TRN-001` means one thing only: the
 * record's stage no longer allows the step (a quotation on a closed job, a
 * cancellation of an appointment already ended, a closure of a visit already
 * closed).
 *
 * `fromFailure` cannot know that. The same code also reports a broken bound or
 * invariant elsewhere (a payment allocation over the open balance, a billing
 * invariant), where "refresh to see where it stands" is false, so the shared
 * mapping keeps the sentence that claims no cause (`STATE_TRANSITION_CODE` in
 * `lib/api/client.ts`). An adapter opts in here only after checking that every
 * `ERR-TRN-001` its operation can answer is a stage refusal.
 *
 * A named precondition still speaks first: a refusal that carries any violation
 * is left exactly as `fromFailure` said it (a discount-approval refusal names
 * its rule this way), and only the generic blocked sentence is ever replaced.
 */
export function fromStateRefusal(failure: ApiFailure, attempt: number): ActionState {
  const state = fromFailure(failure, attempt);
  if (
    failure.kind === 'conflict' &&
    failure.problem?.code === STATE_TRANSITION_CODE &&
    (failure.problem.violations?.length ?? 0) === 0 &&
    state.messageKey === 'state.conflict.blocked.title'
  ) {
    return { ...state, messageKey: 'state.conflict.transition.title' };
  }
  return state;
}

/**
 * Whether a state is a conflict about a field the operator can correct — a
 * duplicate on a named field — rather than about the record having moved on.
 * It reads the marker `fromFailure` sets, never the shared banner key alone.
 * Such a refusal belongs beside the field, like any refused input: no toast,
 * and no advice to reload.
 */
export function isFieldConflict(state: ActionState): boolean {
  return (
    state.status === 'conflict' &&
    state.duplicateField === true &&
    state.messageKey === FIELD_CONFLICT_KEY &&
    Object.keys(state.fieldErrors ?? {}).length > 0
  );
}

export function invalid(
  fieldErrors: Readonly<Record<string, string>>,
  attempt: number,
  messageKey = 'form.formError'
): ActionState {
  return { status: 'invalid', messageKey, fieldErrors, attempt };
}

/**
 * A write whose answer never arrived: the Server Action's promise was REJECTED
 * — the connection dropped, or the server did not answer — so there is no
 * refusal to render, only the fact that nothing came back.
 *
 * Without it a handler that set its button pending, awaited the action and then
 * cleared it left the button pending for good and the rejection unhandled. A
 * submit handler therefore awaits inside `try`, clears its pending flag in
 * `finally`, and renders this state from `catch`: the operator's entries stay
 * on the page and the sentence says to check the connection and try again.
 */
export function unreachable(attempt: number): ActionState {
  return { status: 'unavailable', messageKey: 'state.unavailable.message', attempt };
}

export function success(messageKey: string, attempt: number): ActionState {
  return { status: 'success', messageKey, attempt };
}

/** Whether a state should block a second submission of the same form. */
export function isTerminalSuccess(state: ActionState): boolean {
  return state.status === 'success';
}
