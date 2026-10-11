import { addDays, dayIn, endOfDay, isCalendarDay, startOfDay } from '@/lib/branch-time';
import { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } from './types';

/**
 * The audit log's window of days, checked the way the service checks it.
 *
 * Separate from the screen so the rule is unit logic: the date pickers are hard
 * to type into under jsdom, and the rule is what decides whether a read is made.
 */

export interface DayRange {
  readonly from: string;
  readonly to: string;
}

export type RangeProblem = 'audit.range.incomplete' | 'audit.range.order' | 'audit.range.tooWide';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What is wrong with a pair of days on `zone`'s clock, or `null`. Checked before
 * a read, so a window the service would refuse is said on the box rather than
 * drawn as a failed read.
 *
 * The width is measured exactly as the service measures it
 * (`resolveRange` in `apps/api/src/modules/iam/application/audit-view-service.ts`):
 * the instants the read sends — the first day's start and the last day's end on
 * that clock — may be at most `MAX_WINDOW_DAYS` × 24 hours apart. Counting
 * calendar days instead would pass a window that crosses a daylight-saving fall
 * back, whose extra hour the service refuses.
 */
export function rangeProblem(range: DayRange, zone: string): RangeProblem | null {
  if (!isCalendarDay(range.from) || !isCalendarDay(range.to)) return 'audit.range.incomplete';
  if (range.to < range.from) return 'audit.range.order';
  const span = endOfDay(zone, range.to).getTime() - startOfDay(zone, range.from).getTime();
  if (span > MAX_WINDOW_DAYS * DAY_MS) return 'audit.range.tooWide';
  return null;
}

/**
 * The window the screen opens on: `DEFAULT_WINDOW_DAYS` whole days on `zone`'s
 * clock, ending with the day it is there at `openedAt`. Today counts as one of
 * them, so the first day is `DEFAULT_WINDOW_DAYS - 1` days earlier.
 */
export function openingWindow(zone: string, openedAt: Date): DayRange {
  const today = dayIn(zone, openedAt);
  return { from: addDays(today, -(DEFAULT_WINDOW_DAYS - 1)), to: today };
}
