import type { WindowIssue } from './appointments-contract';

/**
 * Turning what an operator types into the instants the contract demands
 * (P1-28, Wave C — `FE-002`, `FE-003`).
 *
 * ## Why the offset is composed here rather than typed by hand
 *
 * Every appointment window instant MUST carry an explicit UTC offset — the
 * backend refuses a timezone-less value because it would otherwise be resolved
 * against the SERVER zone (`domain/appointment.ts:119`, mirrored by
 * `appointments-contract.ts`). Asking a receptionist to type `+03:00` by hand
 * is asking them to know a fact their clock already knows, so the screen takes
 * a `datetime-local` value — which the browser interprets in the operator's own
 * zone by spec — and appends that zone's offset FOR THAT WALL TIME, DST and
 * all. The composed instant is displayed beside the field, so what will be sent
 * is never a secret.
 *
 * The trade is stated rather than hidden: the operator books in THEIR clock,
 * not the branch's. `resolvedTimeZone()` names the clock on screen. A branch
 * calendar edited from another country shows different wall-clock digits for
 * the same instant, which is the same deliberate decision `lib/format.ts`
 * records for display.
 *
 * ## Why this is not in `appointments-contract.ts`
 *
 * The contract module mirrors frozen server rules and is coordinator-owned
 * this wave. Composition is a SCREEN decision — how typed input becomes a
 * contract value — so it lives beside the screens that make it.
 */

/** `datetime-local` emits `YYYY-MM-DDTHH:mm` (seconds only when set to them). */
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The operator's own UTC offset at the given moment, as `±HH:MM`.
 *
 * Computed from the Date itself so daylight-saving is answered per instant,
 * not per page load. `getTimezoneOffset()` is minutes BEHIND UTC (UTC+3 →
 * -180), hence the sign flip.
 */
export function utcOffsetAt(moment: Date): string {
  const behind = moment.getTimezoneOffset();
  const sign = behind <= 0 ? '+' : '-';
  const total = Math.abs(behind);
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const minutes = String(total % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

/**
 * A `datetime-local` value composed into a full RFC 3339 instant carrying the
 * operator's own offset for that wall time, or `null` when the input is not a
 * complete local date-time (empty, or a browser gave something unparseable).
 *
 * Seconds are always present in the output: the list query's own schema
 * (`z.string().datetime({ offset: true })`) refuses a secondless instant, so
 * one composed shape serves both the calendar range and the window commands.
 */
export function composeInstant(local: string): string | null {
  const trimmed = local.trim();
  if (!LOCAL_DATETIME.test(trimmed)) return null;
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  // A timezone-less date-time string is LOCAL time by the ECMAScript spec —
  // exactly the interpretation the control's own UI promised the operator.
  const moment = new Date(withSeconds);
  if (Number.isNaN(moment.getTime())) return null;
  return `${withSeconds}${utcOffsetAt(moment)}`;
}

/**
 * A `date` input composed into the instant that starts or ends that LOCAL day.
 * `edge` picks which bound of the day the caller means: the calendar's `from`
 * is inclusive from midnight, its `to` inclusive to the last second.
 */
export function composeDayInstant(day: string, edge: 'start' | 'end'): string | null {
  const trimmed = day.trim();
  if (!LOCAL_DATE.test(trimmed)) return null;
  return composeInstant(`${trimmed}T${edge === 'start' ? '00:00:00' : '23:59:59'}`);
}

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
