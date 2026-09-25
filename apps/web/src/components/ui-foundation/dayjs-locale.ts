import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { Locale } from '@/i18n/config';
import { intlLocale } from '@/lib/format';

/**
 * The date library's locales, derived from the product's one date convention.
 *
 * `lib/format.ts` is where the product decides how a date reads:
 * `ar-JO-u-nu-latn` for Arabic (Jordanian Arabic month names with LATIN digits)
 * and `en-GB` for English. The date pickers must read the same, or a date the
 * picker shows and the same date in a table beside it disagree.
 *
 * - English uses dayjs's own `en-gb`, which is exactly `en-GB`: day before
 *   month, 24-hour clock, the week starting on Monday.
 * - Arabic cannot use dayjs's `ar`: it post-formats every digit into
 *   Arabic-Indic numerals, which contradicts the Latin-digit rule. So the
 *   Arabic locale is OWNED here, and its month and weekday names are not typed
 *   in — they are read from `Intl.DateTimeFormat(intlLocale('ar'))`, the same
 *   formatter `lib/format.ts` uses, so the two cannot drift apart.
 *
 * `utc` and `timezone` are extended because business days are decided on a
 * BRANCH's clock (`lib/branch-time.ts`): a picker deciding a business day is
 * given `timezone={branch.timezone}`, and only the dayjs, Luxon and Moment
 * adapters support that.
 */

dayjs.extend(utc);
dayjs.extend(timezone);

/** The Arabic locale's registered name. */
export const ARABIC_DAYJS_LOCALE = 'ar-jo-latn';

/** A fixed reference instant per month/weekday, read at noon UTC. */
function names(options: Intl.DateTimeFormatOptions, dates: readonly Date[]): string[] {
  const format = new Intl.DateTimeFormat(intlLocale('ar'), { ...options, timeZone: 'UTC' });
  return dates.map((date) => format.format(date));
}

const MONTHS = Array.from({ length: 12 }, (_, month) => new Date(Date.UTC(2026, month, 15, 12)));
// 2026-01-04 is a Sunday; dayjs lists weekdays from Sunday.
const WEEKDAYS = Array.from({ length: 7 }, (_, day) => new Date(Date.UTC(2026, 0, 4 + day, 12)));

function dayPeriod(hour: number): string {
  const parts = new Intl.DateTimeFormat(intlLocale('ar'), {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2026, 0, 4, hour)));
  return parts.find((part) => part.type === 'dayPeriod')?.value ?? '';
}

const MORNING = dayPeriod(9);
const EVENING = dayPeriod(21);

/** The Arabic locale object, exported so its derivation can be tested. */
export const arabicDayjsLocale = {
  name: ARABIC_DAYJS_LOCALE,
  months: names({ month: 'long' }, MONTHS),
  monthsShort: names({ month: 'short' }, MONTHS),
  weekdays: names({ weekday: 'long' }, WEEKDAYS),
  weekdaysShort: names({ weekday: 'short' }, WEEKDAYS),
  weekdaysMin: names({ weekday: 'narrow' }, WEEKDAYS),
  // Jordan's working week starts on Saturday (dayjs counts Sunday as 0).
  weekStart: 6,
  yearStart: 1,
  formats: {
    LT: 'h:mm A',
    LTS: 'h:mm:ss A',
    L: 'DD/MM/YYYY',
    LL: 'D MMMM YYYY',
    LLL: 'D MMMM YYYY h:mm A',
    LLLL: 'dddd D MMMM YYYY h:mm A',
  },
  meridiem: (hour: number) => (hour < 12 ? MORNING : EVENING),
  ordinal: (value: number) => String(value),
  // Deliberately empty: the pickers never format a relative time, and a
  // sentence nobody renders is text nobody reviews.
  relativeTime: {},
};

dayjs.locale(arabicDayjsLocale, undefined, true);

/** The dayjs locale the pickers use for a product locale. */
export function dayjsLocaleFor(locale: Locale): string {
  return locale === 'ar' ? ARABIC_DAYJS_LOCALE : 'en-gb';
}
