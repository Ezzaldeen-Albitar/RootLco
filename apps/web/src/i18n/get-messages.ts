import ar from './messages/ar.json';
import en from './messages/en.json';
import type { Locale } from './config';

export type Messages = typeof en;

const CATALOGUES: Record<Locale, Messages> = { ar: ar as Messages, en };

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale];
}

/**
 * Translation lookup.
 *
 * Returns the KEY when a message is missing rather than an empty string, so a
 * gap is visible in the interface and in a screenshot instead of silently
 * rendering nothing. The missing-key CI check is what turns that visibility
 * into a build failure.
 */
export function translate(messages: Messages, key: keyof Messages): string {
  return messages[key] ?? (key as string);
}
