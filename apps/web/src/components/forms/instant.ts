/**
 * One authority for "a moment in time, with its offset attached".
 *
 * ## The rule, and the defect that made it shared
 *
 * A timezone-less local timestamp sent to a `timestamptz` column is resolved
 * against the SERVER's zone. The appointment module refuses one by name and says
 * why (`apps/api/src/modules/reception/domain/appointment.ts:119`: "a real
 * booking on the wrong hour"), and the web mirror of that rule has lived in
 * `features/appointments/appointments-contract.ts` since Wave C.
 *
 * The reception odometer needed exactly the same rule and could not have it: the
 * odometer's edge validation lives in the VEHICLES feature, a feature may never
 * import another feature (`lib/api/read-operation.ts:12-18`), and so the rule was
 * simply absent there. `2026-03-01T09:30` — sixteen characters, no offset —
 * passed the vehicle schema and was bound into `veh.vehicle_odometer_readings`
 * verbatim: a silent three-hour error for a branch at UTC+3, on the record that
 * establishes when custody began, and one that can invert the append-only
 * ordering of the series.
 *
 * So the rule moved here, to a tier both features may import, and the two
 * feature modules re-export it. Copying it would have made a second authority
 * for a value whose whole worth is that there is one of it.
 *
 * ## What "explicit offset" means and why it is bounded
 *
 * `Z`, or `±HH:MM` inside -12:00…+14:00 — the range of civil offsets actually in
 * use. Without a bound, `+16:00` sails past every client guard, satisfies
 * `Date.parse`, and dies in the database as an unmapped `22009`; with the wider
 * `timestamptz` bound of ±15:59 it is refused but the sentence cannot name a
 * value anybody would write. The server states the identical rule in
 * `apps/api/src/modules/reception/domain/appointment.ts`, and the three
 * expressions below are duplicated there verbatim: this file is the browser-side
 * pre-check for that rule, so a classification that drifts from it sends the
 * operator to fix a value the server would have accepted, or lets one through
 * that it would not.
 *
 * ## Three causes, not one
 *
 * A missing offset, a mistyped one (`…+9`, `…+09`) and an impossible one
 * (`…+16:00`) used to be one answer, and the answer told the operator to supply
 * an offset — wrong advice for the two entries that already carried one.
 */

const ZULU = /Z$/;
const OFFSET = /([+-])(\d{2}):(\d{2})$/;
/**
 * A tail that is an offset ATTEMPT rather than an offset. The sign must follow a
 * clock time, which is what keeps the hyphens inside the date (`2026-08-30`)
 * from reading as the start of a displacement.
 */
const OFFSET_ATTEMPT = /\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?[+-][^+-]*$/;

const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;

/** What is wrong with the offset on one instant, `ok` when nothing is. */
export type OffsetIssue = 'ok' | 'missing' | 'unreadable' | 'out_of_range';

export function classifyUtcOffset(value: string): OffsetIssue {
  if (ZULU.test(value)) return 'ok';
  const parts = OFFSET.exec(value);
  if (!parts) return OFFSET_ATTEMPT.test(value) ? 'unreadable' : 'missing';
  const magnitude = Number.parseInt(parts[2] ?? '', 10) * 60 + Number.parseInt(parts[3] ?? '', 10);
  const displacement = parts[1] === '-' ? -magnitude : magnitude;
  // Stated as "inside the bound" so a displacement that failed to read as a
  // number is refused rather than admitted.
  return displacement >= MIN_OFFSET_MINUTES && displacement <= MAX_OFFSET_MINUTES
    ? 'ok'
    : 'out_of_range';
}

export function hasExplicitUtcOffset(value: string): boolean {
  return classifyUtcOffset(value) === 'ok';
}

/**
 * The refusals this layer can decide locally about one instant. Stable tokens,
 * not translation keys — a screen maps them to its own catalogue entries, and a
 * token that reached an operator raw would be a defect in the screen.
 */
export type InstantIssue =
  | 'empty'
  | 'too_long'
  | 'missing_offset'
  | 'offset_unreadable'
  | 'offset_out_of_range'
  | 'unparseable';

/** `z.string().min(1).max(64)` on both appointment window route schemas. */
export const MAX_INSTANT_LENGTH = 64;

export function validateInstant(
  value: string,
  maxLength: number = MAX_INSTANT_LENGTH
): InstantIssue | 'ok' {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > maxLength) return 'too_long';
  const offset = classifyUtcOffset(trimmed);
  if (offset === 'missing') return 'missing_offset';
  if (offset === 'unreadable') return 'offset_unreadable';
  if (offset === 'out_of_range') return 'offset_out_of_range';
  if (Number.isNaN(Date.parse(trimmed))) return 'unparseable';
  return 'ok';
}

/* ------------------------------------------------------------------ *
 * Composition — what an operator types, turned into what the rule demands
 * ------------------------------------------------------------------ */

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
 * Seconds are always present in the output: the appointment list query's own
 * schema (`z.string().datetime({ offset: true })`) refuses a secondless instant,
 * so one composed shape serves the calendar range, the window commands and the
 * odometer alike.
 *
 * Asking a receptionist to type `+03:00` by hand is asking them to state a fact
 * their clock already knows, which is why every screen that needs an instant
 * composes it here rather than validating what somebody typed.
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
 * What a form should say about one typed moment, or `null` to proceed.
 *
 * ## Why this exists when the control already prevents the problem
 *
 * `<input type="datetime-local">` applies the HTML value-sanitisation algorithm:
 * anything that is not a complete local date-time becomes the empty string. On a
 * browser that implements it there is no partial value for `composeInstant` to
 * refuse — which is the point of using the control.
 *
 * A browser that does NOT implement it falls back to a plain text box, silently,
 * and then the operator can type whatever they like into the field that decides
 * when custody began. `2026-03-01T09:30` is what they will type, because it is
 * what the box shows them; unguarded it composes and is fine, but
 * `2026-03-01T09:30:00Z` — the shape the old hint asked for — does NOT match a
 * local date-time, would compose to `null`, and must not be submitted as-is.
 *
 * So this is the fallback path's rule, stated once and unit-tested directly
 * rather than asserted through a control that cannot express the failure.
 */
export function instantFieldError(typed: string, required: boolean): string | null {
  const trimmed = typed.trim();
  if (trimmed === '') return required ? 'field.required' : null;
  const composed = composeInstant(trimmed);
  // `composeInstant` only ever returns a value carrying an offset, so the second
  // clause states the rule by name rather than assuming the composition held.
  if (composed === null || !hasExplicitUtcOffset(composed)) return 'field.instantNeedsOffset';
  return null;
}

/**
 * The reverse trip: an offset-bearing instant back into the `datetime-local`
 * value that shows the same MOMENT on the operator's own clock.
 *
 * Used to seed the control from a stored value. Returns `''` for anything
 * unparseable rather than throwing — a control that refuses to mount because one
 * stored value was odd loses the operator the whole form.
 */
export function toLocalDateTimeValue(instant: string): string {
  const moment = new Date(instant);
  if (Number.isNaN(moment.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
    `T${pad(moment.getHours())}:${pad(moment.getMinutes())}`
  );
}
