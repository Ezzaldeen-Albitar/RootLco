/**
 * The dashboard period, resolved as calendar days in ONE named timezone.
 *
 * ## Why this is a domain rule and not a query fragment
 *
 * `server/db/period.ts` already owns the SQL half of the Owner decision D-17 —
 * every reported period is half-open `[from, to)` and converted in the branch's
 * own zone, once, so two figures over one period cannot disagree. What it does
 * not own is the ARITHMETIC that turns the four words a caller may send —
 * `today`, `yesterday`, `last7`, `custom` — into that pair of calendar days.
 * That arithmetic is a rule about dates and nothing else: it touches no row,
 * opens no connection, and is decided the same way whoever asks. So it lives
 * here, where the boundary checker guarantees it cannot reach for a database,
 * and the SQL predicate stays where it already was.
 *
 * ## `today` is an ARGUMENT, never read from this process
 *
 * A calendar day is a fact about a place. "Today" in a workshop is decided by
 * the branch's `org.branches.timezone_name`, and the instant it changes is
 * decided by a clock. Reading either from the application server would make the
 * boundary depend on the drift between two machines and on whatever `TZ` the
 * container happened to inherit — the same argument `readSessionState` makes for
 * answering expiry questions in SQL. So the caller measures the local day on the
 * database clock and passes it in, and this file does pure arithmetic over
 * `YYYY-MM-DD` strings.
 *
 * ## Both refusals are the caller's fault and both are 422
 *
 * An inverted custom range and an over-long one are refused rather than
 * clamped. Clamping would answer a question nobody asked and publish the answer
 * under the caller's own `from`/`to`, which reads as agreement.
 */
import { AppFailure } from '@/server/errors/app-failure';

/** The four periods a caller may ask for. */
export const DASHBOARD_PERIOD_KINDS = ['today', 'yesterday', 'last7', 'custom'] as const;

export type DashboardPeriodKind = (typeof DASHBOARD_PERIOD_KINDS)[number];

/**
 * The longest custom range this read will compute, in days.
 *
 * Ninety-two is a calendar quarter's worst case (July + August + September is
 * 92 days), so a caller may ask for any one quarter and no more. The bound is
 * on the DAY COUNT rather than on the month names because the trend series
 * carries one point per day and the cost of the read is linear in that count.
 */
export const MAX_DASHBOARD_PERIOD_DAYS = 92;

/** A resolved period: what was asked for, and the half-open pair it means. */
export interface DashboardPeriod {
  readonly kind: DashboardPeriodKind;
  /** First day included, `YYYY-MM-DD`. */
  readonly from: string;
  /** LAST day included, `YYYY-MM-DD`. Published, because it is what was asked. */
  readonly to: string;
  /** First day EXCLUDED, `YYYY-MM-DD`. Used by the SQL predicate, never published. */
  readonly toExclusive: string;
  /** The IANA zone the three days above are calendar days IN. */
  readonly timezoneName: string;
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function refuse(message: string, path: string, rule: string): never {
  throw new AppFailure('ERR-VAL-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
  });
}

/**
 * Reads a `YYYY-MM-DD` string as a UTC midnight instant.
 *
 * UTC is not a claim about where the day is — the zone travels separately, in
 * `timezoneName`, and is applied by the SQL predicate. It is how this file does
 * day arithmetic without a local-time offset creeping into a subtraction, which
 * is the ordinary way a "last seven days" quietly becomes six or eight across a
 * daylight-saving boundary.
 */
function readDay(value: string, path: string): number {
  if (!CALENDAR_DAY.test(value)) refuse(`${path} is not a calendar day`, path, 'invalid_format');
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) refuse(`${path} is not a calendar day`, path, 'invalid_format');
  // `Date.parse` accepts 2026-02-31 on some inputs and normalises it; comparing
  // the rendering back is what refuses a day that does not exist.
  if (renderDay(parsed) !== value) refuse(`${path} is not a calendar day`, path, 'invalid_format');
  return parsed;
}

/** Renders a UTC midnight instant back as `YYYY-MM-DD`. */
function renderDay(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/** Shifts a `YYYY-MM-DD` by whole days. */
export function shiftDay(day: string, days: number): string {
  return renderDay(readDay(day, 'day') + days * MS_PER_DAY);
}

/**
 * Every calendar day in `[from, toExclusive)`, in order.
 *
 * The trend series is built from this rather than from the rows, so a day on
 * which nothing happened is a zero and not a gap. A chart drawn from a gapped
 * series draws a shorter period than the one it is labelled with.
 */
export function enumerateDays(period: DashboardPeriod): readonly string[] {
  const days: string[] = [];
  const end = readDay(period.toExclusive, 'to');
  for (let cursor = readDay(period.from, 'from'); cursor < end; cursor += MS_PER_DAY) {
    days.push(renderDay(cursor));
  }
  return days;
}

/**
 * Resolves the period a caller asked for against the local day it is there.
 *
 * `from` and `to` are read ONLY for `custom`. A caller that sends them beside
 * `today` has them ignored rather than refused, because the three fixed kinds
 * are complete descriptions on their own and the route's schema already refuses
 * anything it does not recognise.
 */
export function resolveDashboardPeriod(input: {
  readonly kind: DashboardPeriodKind;
  /** The local calendar day, measured in `timezoneName` on the database clock. */
  readonly localToday: string;
  readonly timezoneName: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}): DashboardPeriod {
  const today = input.localToday;

  if (input.kind === 'custom') {
    if (input.from === undefined || input.to === undefined) {
      refuse('A custom period needs both from and to', 'from', 'required');
    }
    const first = readDay(input.from, 'from');
    const last = readDay(input.to, 'to');
    if (last < first) {
      refuse('The custom period ends before it begins', 'to', 'out_of_range');
    }
    const days = Math.round((last - first) / MS_PER_DAY) + 1;
    if (days > MAX_DASHBOARD_PERIOD_DAYS) {
      refuse(
        `A custom period covers at most ${MAX_DASHBOARD_PERIOD_DAYS} days`,
        'to',
        'out_of_range'
      );
    }
    return {
      kind: 'custom',
      from: input.from,
      to: input.to,
      toExclusive: renderDay(last + MS_PER_DAY),
      timezoneName: input.timezoneName,
    };
  }

  // `readDay` is called for its validation as much as for its value: the local
  // day arrives from a database read and a malformed one must not become a
  // predicate.
  readDay(today, 'localToday');

  if (input.kind === 'yesterday') {
    const start = shiftDay(today, -1);
    return {
      kind: 'yesterday',
      from: start,
      to: start,
      toExclusive: today,
      timezoneName: input.timezoneName,
    };
  }

  // `last7` INCLUDES today, so it starts six days back. Seven days ending
  // yesterday would be a different question and is not the one the word asks.
  const start = input.kind === 'last7' ? shiftDay(today, -6) : today;
  return {
    kind: input.kind,
    from: start,
    to: today,
    toExclusive: shiftDay(today, 1),
    timezoneName: input.timezoneName,
  };
}
