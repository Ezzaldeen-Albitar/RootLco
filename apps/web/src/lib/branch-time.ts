/**
 * Calendar days measured on the BRANCH's clock, not on the browser's.
 *
 * ## Why `lib/format.ts` cannot answer this
 *
 * That module formats an instant for reading, and it does so in the browser's
 * own zone — deliberately, so an appointment time means the time on the clock in
 * front of the operator. Its own docblock names the limit: *"Anything that must
 * agree across locations (a period boundary, an audit window) formats
 * server-side or carries an explicit timezone. Nothing here decides a business
 * date."*
 *
 * A board whose default period is "today" decides a business date. A service
 * adviser in one branch looking at another branch's day must be shown that
 * branch's day, and a laptop whose zone was never set would otherwise silently
 * move the boundary by hours. So the zone is passed in — it comes from
 * `branches[].timezone` on the working context, which is `org.branches.
 * timezone_name` as the platform publishes it — and never inferred.
 *
 * ## The boundary arithmetic, and why it iterates
 *
 * There is no standard way to ask "what instant is midnight on 2026-09-22 in
 * Asia/Riyadh". What IS available is the reverse: `Intl.DateTimeFormat` with a
 * `timeZone` renders a known instant as a local wall clock. So the offset is
 * MEASURED at a guessed instant and the guess is corrected — twice, because a
 * correction can itself cross a daylight-saving transition and land in a
 * different offset than the one just measured. Two passes settle every zone
 * with an offset change of less than a day, which is every zone there is.
 *
 * ## What is deliberately NOT here
 *
 * No "due", no "overdue", no "late". The platform records no due date on a
 * reception visit or a work order, so nothing in this application may compute
 * one; a helper that made it easy would be the first step toward inventing one.
 */

/** A calendar day, `YYYY-MM-DD`, in some named zone. */
export type CalendarDay = string;

/** `YYYY-MM-DD` and nothing else, so a caller cannot pass an instant by mistake. */
export const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(value: string): boolean {
  return CALENDAR_DAY_PATTERN.test(value);
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * The wall clock a zone was showing at an instant.
 *
 * `en-CA` with `hour12: false` is not a display choice — it is the one widely
 * implemented locale whose `formatToParts` yields unpadded-free numeric parts
 * for every field, so the parts can be read as numbers rather than parsed out of
 * a sentence. `hourCycle: 'h23'` because `hour12: false` alone renders midnight
 * as 24 in several implementations, and 24 is not an hour of the day this
 * arithmetic can use.
 */
function wallClockIn(zone: string, instant: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number.parseInt(found.value, 10);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** The calendar day a zone is on at an instant. Defaults to now. */
export function dayIn(zone: string, instant: Date = new Date()): CalendarDay {
  const clock = wallClockIn(zone, instant);
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}`;
}

/**
 * The same clock time, a whole number of days earlier or later.
 *
 * Arithmetic on the DAY rather than on the instant: adding 86 400 000 ms to an
 * instant is a day only in a zone with no transitions, and the days this moves
 * between are the ones a quick filter names.
 */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10));
  // UTC arithmetic on a bare calendar triple. The result is read back as a
  // calendar triple too, so no zone is involved in either direction.
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + delta));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The instant at which a calendar day begins in a zone. */
export function startOfDay(zone: string, day: CalendarDay): Date {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10));
  const wanted = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, 0, 0, 0, 0);
  let guess = wanted;
  // Two passes: the first measures the offset at the guess, the second measures
  // it again at the corrected instant in case the correction crossed a
  // transition. See the docblock.
  for (let pass = 0; pass < 2; pass += 1) {
    const clock = wallClockIn(zone, new Date(guess));
    const shown = Date.UTC(
      clock.year,
      clock.month - 1,
      clock.day,
      clock.hour,
      clock.minute,
      clock.second
    );
    guess = guess + (wanted - shown);
  }
  return new Date(guess);
}

/**
 * The LAST millisecond of a calendar day in a zone, as a `Date`.
 *
 * One millisecond before the next day begins. A `Date` cannot hold anything
 * finer, so this is NOT the bound a request sends — see `endOfDayBound`.
 */
export function endOfDay(zone: string, day: CalendarDay): Date {
  return new Date(startOfDay(zone, addDays(day, 1)).getTime() - 1);
}

/** `±HH:MM` for an offset in minutes east of UTC. */
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const whole = Math.abs(minutes);
  return `${sign}${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

/** The offset a zone is on at an instant, in minutes east of UTC. */
export function offsetMinutesAt(zone: string, instant: Date): number {
  const clock = wallClockIn(zone, instant);
  const shown = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second
  );
  // The wall clock is read to the second, so the instant is too.
  const measured = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((shown - measured) / 60_000);
}

/**
 * The LAST instant of a calendar day in a zone, as the string a request sends:
 * `YYYY-MM-DDT23:59:59.999999±HH:MM`, on that zone's wall clock and with the
 * offset in force at that instant.
 *
 * ## Why microseconds, and why a string
 *
 * The list filters this feeds compare CLOSED on both ends
 * (`custody_accepted_at <= to`, `opened_at <= openedTo`, an appointment's start
 * `<= to`). A half-open bound passed to a closed comparison silently includes
 * the first instant of the following day, which is how a "today" board comes
 * to show tomorrow's first car. The opposite error is subtler: PostgreSQL
 * stores `timestamptz` to the MICROSECOND, so a bound at `.999` milliseconds
 * leaves out a row stamped in the last 999 microseconds of the day. The bound
 * is therefore written to six fractional digits, which a `Date` cannot hold —
 * hence a string built from the wall clock, not `toISOString()`.
 *
 * The routes validate these parameters with `z.string().datetime({ offset:
 * true })`, which accepts any number of fractional digits. The reception and
 * appointment routes hand the string to the database as it came, so the bound
 * holds to the microsecond there. The work-order route parses `openedTo` and
 * `completedTo` into a `Date` before querying, which keeps milliseconds only:
 * on that board the last 999 microseconds of a day are still outside the
 * bound. That is a limitation of the route, recorded here rather than papered
 * over on this side.
 */
export function endOfDayBound(zone: string, day: CalendarDay): string {
  const last = endOfDay(zone, day);
  const clock = wallClockIn(zone, last);
  const date = `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}`;
  const time = `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`;
  return `${date}T${time}.999999${offsetText(offsetMinutesAt(zone, last))}`;
}

/**
 * An inclusive instant range over a span of calendar days in one zone: the
 * first instant of `from` (`toISOString()`, UTC) and the last instant of `to`
 * (`endOfDayBound`, the zone's offset, microseconds).
 */
export function rangeOfDays(
  zone: string,
  from: CalendarDay,
  to: CalendarDay
): { readonly from: string; readonly to: string } {
  return { from: startOfDay(zone, from).toISOString(), to: endOfDayBound(zone, to) };
}

/** Whether an instant falls on a given calendar day in a zone. */
export function fallsOn(zone: string, day: CalendarDay, instant: string): boolean {
  return dayIn(zone, new Date(instant)) === day;
}

/**
 * An instant, rendered on the branch's clock.
 *
 * The counterpart of `formatDateTime` in `lib/format.ts`, and it exists for the
 * same reason this module does: a board headed "today in Main workshop" whose
 * times are rendered on the reader's laptop clock can show a row stamped 01:30
 * under a heading claiming it arrived today.
 */
export function formatInZone(value: string, intlLocale: string, zone: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: zone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/**
 * The name of the clock an instant is rendered on, as the reader's language
 * writes it (`GMT+3`, `GMT-4`): written beside a time whenever
 * the reader cannot tell from the screen which clock it is.
 */
export function zoneLabelAt(value: string, intlLocale: string, zone: string): string {
  const parts = new Intl.DateTimeFormat(intlLocale, {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(value));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

/** A day, rendered for reading, on the branch's clock. */
export function formatDayInZone(day: CalendarDay, intlLocale: string, zone: string): string {
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone: zone,
    dateStyle: 'medium',
  }).format(startOfDay(zone, day));
}
