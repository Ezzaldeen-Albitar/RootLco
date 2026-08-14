import type { WindowIssue } from './appointments-contract';

/**
 * Turning what an operator types into the instants the contract demands
 * (P1-28, Wave C — `FE-002`, `FE-003`).
 *
 * ## Why the offset is composed rather than typed by hand
 *
 * Every appointment window instant MUST carry an explicit UTC offset — the
 * backend refuses a timezone-less value because it would otherwise be resolved
 * against the SERVER zone (`domain/appointment.ts:119`). Asking a receptionist
 * to type `+03:00` by hand is asking them to know a fact their clock already
 * knows, so the screen takes a `datetime-local` value — which the browser
 * interprets in the operator's own zone by spec — and appends that zone's offset
 * FOR THAT WALL TIME, DST and all. The composed instant is displayed beside the
 * field, so what will be sent is never a secret.
 *
 * The trade is stated rather than hidden: the operator books in THEIR clock,
 * not the branch's. `resolvedTimeZone()` names the clock on screen. A branch
 * calendar edited from another country shows different wall-clock digits for
 * the same instant, which is the same deliberate decision `lib/format.ts`
 * records for display.
 *
 * ## Where the composition itself now lives
 *
 * `components/forms/instant.ts`. It was defined here, and the reception odometer
 * needed exactly the same three functions through the VEHICLES feature — which
 * may never import this one, so the odometer had no offset rule at all and
 * accepted `2026-03-01T09:30` into a `timestamptz`. Moving it up a tier gave
 * both features one authority instead of one authority and one hole. This module
 * re-exports, so every appointment screen and test that imports from here is
 * unchanged, and it keeps what is genuinely appointment-specific: the mapping
 * from a window refusal to this screen's own sentence.
 */

export {
  utcOffsetAt,
  composeInstant,
  composeDayInstant,
  toLocalDateTimeValue,
} from '@/components/forms/instant';

/**
 * The catalogue key for each refusal `validateWindow` can decide locally.
 * Tokens, not prose — the contract publishes stable tokens precisely so a
 * screen maps them to its own translated sentences, and a raw token reaching
 * an operator would be a defect in the screen.
 */
export const WINDOW_ISSUE_KEY: Readonly<Record<WindowIssue, string>> = Object.freeze({
  empty: 'field.required',
  too_long: 'field.tooLong',
  missing_offset: 'field.instantNeedsOffset',
  unparseable: 'field.invalid',
  not_after_start: 'field.windowEndsBeforeStart',
});
