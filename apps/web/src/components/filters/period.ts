import {
  addDays,
  dayIn,
  endOfDay,
  isCalendarDay,
  rangeOfDays,
  type CalendarDay,
} from '@/lib/branch-time';

/**
 * The periods a board or a dashboard is read over, and what each one sends.
 *
 * ## One vocabulary, two wire formats
 *
 * The screens that filter by period already name the same presets — today,
 * yesterday, the last seven days, before today and a chosen pair of days — and
 * already disagree, deliberately, about what they SEND:
 *
 *   - the dashboard summary takes the preset's NAME, and for a chosen period the
 *     two CALENDAR DAYS (`YYYY-MM-DD`); the server resolves them on the
 *     branch's clock and answers with the days it used (`format: 'days'`);
 *   - the reception and work-order boards take INSTANTS — the first instant of
 *     the first day and the LAST instant of the last day on the branch's clock,
 *     because their filters compare closed on both ends (`format: 'instants'`,
 *     `lib/branch-time.ts#rangeOfDays`).
 *
 * `periodWindow` produces exactly what each already sends, so a screen that
 * moves onto `FilterToolbar` changes none of its requests.
 *
 * ## Whose clock
 *
 * Every day here is a day on the ZONE passed in — the branch's IANA zone —
 * never the laptop's. "Today" at 00:30 in one branch can be yesterday on the
 * laptop reading it.
 */

export const PERIOD_KINDS = ['today', 'yesterday', 'last7', 'beforeToday', 'custom'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** The period in force: a preset, or a chosen pair of days (only for `custom`). */
export interface PeriodSelection {
  readonly kind: PeriodKind;
  /** First day included, `YYYY-MM-DD`. `''` unless `kind` is `custom`. */
  readonly from: CalendarDay | '';
  /** Last day included, `YYYY-MM-DD`. `''` unless `kind` is `custom`. */
  readonly to: CalendarDay | '';
}

export const TODAY_PERIOD: PeriodSelection = Object.freeze({ kind: 'today', from: '', to: '' });

export type PeriodFormat = 'days' | 'instants';

/** What a period sends. A bound is absent when the period has none. */
export interface PeriodWindow {
  readonly from?: string;
  readonly to?: string;
}

/** The first and last calendar day a period covers on `zone`'s clock. */
export function periodDays(
  selection: PeriodSelection,
  zone: string,
  now: Date = new Date()
): { readonly from?: CalendarDay; readonly to?: CalendarDay } {
  const today = dayIn(zone, now);
  switch (selection.kind) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'last7':
      // Seven days INCLUDING today: six back, plus today.
      return { from: addDays(today, -6), to: today };
    case 'beforeToday':
      // No lower bound: "what is still here from before today" names no start.
      return { to: addDays(today, -1) };
    case 'custom':
      return selection.from === '' || selection.to === ''
        ? {}
        : { from: selection.from, to: selection.to };
  }
}

/** The bounds a period sends, in the format the reading operation takes. */
export function periodWindow(
  selection: PeriodSelection,
  zone: string,
  format: PeriodFormat,
  now: Date = new Date()
): PeriodWindow {
  const days = periodDays(selection, zone, now);
  if (format === 'days') return days;
  if (days.from !== undefined && days.to !== undefined) {
    return rangeOfDays(zone, days.from, days.to);
  }
  // The last instant of the last day, because the boards compare `<= to`: the
  // first instant of the next day would put its first arrival on this board.
  if (days.to !== undefined) return { to: endOfDay(zone, days.to).toISOString() };
  return {};
}

const DAY_MS = 86_400_000;

/** How many calendar days a chosen period covers, both ends included. */
export function daysCovered(from: CalendarDay, to: CalendarDay): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** What is wrong with a chosen pair of days, and which of the two boxes to fix. */
export type CustomPeriodProblem =
  | { readonly field: 'from' | 'to'; readonly problem: 'incomplete' }
  | { readonly field: 'to'; readonly problem: 'inverted' }
  | { readonly field: 'to'; readonly problem: 'tooLong'; readonly maxDays: number };

/**
 * Checks a chosen pair of days before anything is asked for.
 *
 * Refused here rather than at the server: an inverted or over-long range is
 * answered 422, and a page-level failure teaches nobody which box to fix. The
 * longest period is the OPERATION's (`maxDays`; the dashboard summary accepts a
 * calendar quarter's worst case, 92 days), passed by the screen that knows it.
 */
export function checkCustomPeriod(
  from: string,
  to: string,
  maxDays?: number
): CustomPeriodProblem | null {
  if (!isCalendarDay(from)) return { field: 'from', problem: 'incomplete' };
  if (!isCalendarDay(to)) return { field: 'to', problem: 'incomplete' };
  if (to < from) return { field: 'to', problem: 'inverted' };
  if (maxDays !== undefined && daysCovered(from, to) > maxDays) {
    return { field: 'to', problem: 'tooLong', maxDays };
  }
  return null;
}
