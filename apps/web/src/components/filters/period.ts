import {
  addDays,
  dayIn,
  endOfDayBound,
  isCalendarDay,
  rangeOfDays,
  type CalendarDay,
} from '@/lib/branch-time';

/**
 * The periods a board or a dashboard is read over, and what each one sends.
 *
 * ## One vocabulary, two requests
 *
 * The screens that filter by period name the same presets — today, yesterday,
 * the last seven days, before today and a chosen pair of days — and send them
 * in two different shapes, one per kind of operation. Each shape is its own
 * function, so a screen cannot ask for the other's by passing the wrong flag:
 *
 *   - `dashboardPeriodRequest` — the dashboard summary takes the preset's NAME
 *     and nothing else (`{ period: 'today' }`); only a chosen period adds its
 *     two CALENDAR DAYS (`{ period: 'custom', from: 'YYYY-MM-DD', to: … }`).
 *     The server resolves the days on the branch's clock and answers with the
 *     days it used. The dashboard names no "before today", so that preset has
 *     no dashboard request (`null`), and neither has a chosen period missing
 *     a day.
 *   - `boardInstantWindow` — the reception, work-order and appointment boards
 *     take INSTANTS: the first instant of the first day and the LAST instant of
 *     the last day on the branch's clock (`lib/branch-time.ts#rangeOfDays`,
 *     `#endOfDayBound`), because their filters compare closed on both ends.
 *     "Before today" sends only the upper bound.
 *
 * Each produces exactly what its screens already send, so a screen that moves
 * onto `FilterToolbar` changes none of its requests.
 *
 * ## Whose clock
 *
 * Every day here is a day on the ZONE passed in — the branch's IANA zone —
 * never the laptop's. "Today" at 00:30 in one branch can be yesterday on the
 * laptop reading it.
 */

export const PERIOD_KINDS = ['today', 'yesterday', 'last7', 'beforeToday', 'custom'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** The presets the dashboard summary names: `DASHBOARD_PERIODS` in the overview contract. */
export type DashboardPeriodKind = Exclude<PeriodKind, 'beforeToday'>;

/** The period in force: a preset, or a chosen pair of days (only for `custom`). */
export interface PeriodSelection {
  readonly kind: PeriodKind;
  /** First day included, `YYYY-MM-DD`. `''` unless `kind` is `custom`. */
  readonly from: CalendarDay | '';
  /** Last day included, `YYYY-MM-DD`. `''` unless `kind` is `custom`. */
  readonly to: CalendarDay | '';
}

export const TODAY_PERIOD: PeriodSelection = Object.freeze({ kind: 'today', from: '', to: '' });

/** Which request a period is sent as. See the docblock. */
export type PeriodRequestMode = 'dashboard' | 'instants';

/** What the dashboard summary is asked for: a preset's name, or a chosen pair of days. */
export type DashboardPeriodRequest =
  | { readonly period: Exclude<DashboardPeriodKind, 'custom'> }
  | { readonly period: 'custom'; readonly from: CalendarDay; readonly to: CalendarDay };

/** What a board is asked for: instants. A bound is absent when the period has none. */
export interface InstantWindow {
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

/**
 * The dashboard summary's request for a period: the preset's name alone, or
 * `custom` with its two days. `null` for a period the dashboard does not name
 * (`beforeToday`) and for a chosen period missing a day. No zone: the server
 * resolves the days on the branch's clock itself.
 */
export function dashboardPeriodRequest(selection: PeriodSelection): DashboardPeriodRequest | null {
  switch (selection.kind) {
    case 'today':
    case 'yesterday':
    case 'last7':
      return { period: selection.kind };
    case 'beforeToday':
      return null;
    case 'custom':
      return isCalendarDay(selection.from) && isCalendarDay(selection.to)
        ? { period: 'custom', from: selection.from, to: selection.to }
        : null;
  }
}

/** A board's request for a period: closed instant bounds on `zone`'s clock. */
export function boardInstantWindow(
  selection: PeriodSelection,
  zone: string,
  now: Date = new Date()
): InstantWindow {
  const days = periodDays(selection, zone, now);
  if (days.from !== undefined && days.to !== undefined) {
    return rangeOfDays(zone, days.from, days.to);
  }
  // The last instant of the last day, because the boards compare `<= to`: the
  // first instant of the next day would put its first arrival on this board.
  if (days.to !== undefined) return { to: endOfDayBound(zone, days.to) };
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
