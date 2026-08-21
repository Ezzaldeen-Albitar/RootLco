import type { Locale } from '@/i18n/config';

/**
 * Locale-safe formatting for display.
 *
 * ## Timezone, written down because it is a decision and not a default
 *
 * Dates and times are formatted in the BROWSER's timezone. A workshop operator
 * looks at an appointment time and needs it to mean the time on the clock in
 * front of them, so the alternative — pinning to the company's configured
 * timezone — would be right for a report and wrong for a shift.
 *
 * The consequence is deliberate and must be remembered when the reporting module
 * arrives: a timestamp rendered in Amman and the same timestamp rendered in
 * Riyadh are different strings for the same instant. Anything that must agree
 * across locations (a period boundary, an audit window) formats server-side or
 * carries an explicit timezone. Nothing here decides a business date.
 *
 * ## Numerals
 *
 * `ar` uses Latin digits, not Eastern Arabic ones. Workshop paperwork, plates,
 * VINs and invoices in Jordan are written with Latin digits, and a table where
 * the amounts are in ٠١٢٣ and the reference numbers are in 0123 is harder to
 * scan than either alone. Set through the `-u-nu-latn` extension rather than by
 * transliterating after the fact.
 */

const NUMBERING: Record<Locale, string> = {
  ar: 'ar-JO-u-nu-latn',
  en: 'en-GB',
};

export function intlLocale(locale: Locale): string {
  return NUMBERING[locale];
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatInteger(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(value);
}

/** Date only. `dateStyle: 'medium'` avoids the ambiguous all-numeric forms. */
export function formatDate(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium' }).format(asDate(value));
}

export function formatTime(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeStyle: 'short' }).format(asDate(value));
}

export function formatDateTime(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(asDate(value));
}

/** The browser's resolved timezone, so a screen can state which clock it used. */
export function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
