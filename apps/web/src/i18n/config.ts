/**
 * Locale configuration.
 *
 * Arabic is first in the list deliberately: Benzene, the first configured pilot
 * tenant, operates in Arabic, and a list that puts English first tends to
 * produce code that treats RTL as the exception.
 */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

/** Text direction per locale. The ONLY place direction is decided. */
export const DIRECTION: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return DIRECTION[locale];
}
