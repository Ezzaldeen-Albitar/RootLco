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

/*
 * Reference values by NAME, in the reader's language (P1-32-PRE-OD-QAF, D-1).
 *
 * A currency, a language and a time zone are stored and sent as their codes, and
 * a select must keep the code as its value; what the operator reads is the name.
 * `Intl.DisplayNames` and the zone's generic name answer in the reader's language
 * from the browser's own data, so no list of names is shipped. The code stays
 * beside a currency and a zone as a secondary hint, because two names can read
 * alike and the code is what the paperwork carries. A code the runtime does not
 * know falls back to the name the reference register holds, and then to the code
 * itself, never to nothing.
 */
function displayName(
  type: 'currency' | 'language',
  code: string,
  locale: Locale
): string | undefined {
  try {
    const name = new Intl.DisplayNames([intlLocale(locale)], { type, fallback: 'none' }).of(code);
    return name && name.trim().length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

function presentName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

/** "Jordanian Dinar (JOD)" in English, the Arabic name with the same code in Arabic. */
export function currencyLabel(code: string, locale: Locale, registerName?: string): string {
  const name = displayName('currency', code, locale) ?? presentName(registerName);
  return name && name !== code ? `${name} (${code})` : code;
}

/** A language's name in the reader's language; the register's name, then the code, when unknown. */
export function languageLabel(code: string, locale: Locale, registerName?: string): string {
  return displayName('language', code, locale) ?? presentName(registerName) ?? code;
}

/** A fixed instant, so a zone's label does not change with the day it is read. */
const ZONE_LABEL_INSTANT = new Date(Date.UTC(2026, 0, 15, 12));

/** A zone's generic name in the reader's language with its identifier: "Jordan Time (Asia/Amman)". */
export function timeZoneLabel(zone: string, locale: Locale): string {
  try {
    const name = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: zone,
      timeZoneName: 'longGeneric',
    })
      .formatToParts(ZONE_LABEL_INSTANT)
      .find((part) => part.type === 'timeZoneName')?.value;
    return name && name !== zone ? `${name} (${zone})` : zone;
  } catch {
    return zone;
  }
}
