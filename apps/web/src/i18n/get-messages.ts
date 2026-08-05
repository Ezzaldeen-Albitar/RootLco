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

/**
 * Translation by a key that is only known at runtime.
 *
 * `translate` takes `keyof Messages`, which is right: it turns a typo in a
 * literal key into a compile error. But a key built from server data —
 * `crm.lifecycle.${status}` where `status` is a `string` from the API, or a
 * `messageKey` returned by a Server Action — cannot satisfy that type, and
 * casting at each call site puts the escape hatch in thirty places.
 *
 * One widening, here, beside the authority it widens. Behaviour is identical:
 * a missing key still renders as the key, so a gap is visible in the interface
 * and in a screenshot, and the missing-key CI check still fails the build.
 *
 * Prefer `translate` wherever the key is a literal. This is for the cases where
 * it genuinely is not.
 */
export function translateDynamic(messages: Messages, key: string): string {
  return translate(messages, key as keyof Messages);
}
