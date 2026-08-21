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
 * ## What "explicit offset" means and why it is capped
 *
 * `Z`, or `±HH:MM` with the displacement capped at ±15:59 — PostgreSQL's own
 * `timestamptz` limit. V8 parses `+16:00` happily, so without the cap the value
 * sails past every client and server guard and dies in the database as an
 * unmapped `22009`.
 */

const EXPLICIT_OFFSET = /(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/;

export function hasExplicitUtcOffset(value: string): boolean {
  return EXPLICIT_OFFSET.test(value);
}

/**
 * The refusals this layer can decide locally about one instant. Stable tokens,
 * not translation keys — a screen maps them to its own catalogue entries, and a
 * token that reached an operator raw would be a defect in the screen.
 */
export type InstantIssue = 'empty' | 'too_long' | 'missing_offset' | 'unparseable';

/** `z.string().min(1).max(64)` on both appointment window route schemas. */
export const MAX_INSTANT_LENGTH = 64;

export function validateInstant(
  value: string,
  maxLength: number = MAX_INSTANT_LENGTH
): InstantIssue | 'ok' {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > maxLength) return 'too_long';
  if (!hasExplicitUtcOffset(trimmed)) return 'missing_offset';
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
