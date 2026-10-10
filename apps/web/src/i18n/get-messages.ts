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

/**
 * Fills `{name}` placeholders in a catalogue message.
 *
 * A placeholder with no value is LEFT AS WRITTEN rather than blanked, so a
 * missing value is visible in the interface instead of producing a sentence
 * that silently says "allows  branches". Values are plain text; nothing here is
 * ever treated as markup.
 */
export function formatMessage(
  template: string,
  values: Readonly<Record<string, string>> | undefined
): string {
  if (values === undefined) return template;
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? (values[name] as string) : whole
  );
}

/** The suffix a failure HEADING key ends in, and the one its sentence ends in. */
const HEADING_SUFFIX = '.title';
const EXPLANATION_SUFFIX = '.message';

/**
 * The sentence that belongs under a failure heading, when the catalogue has one.
 *
 * A heading is a label: "You do not have access", "Not found". Shown on its own
 * in a banner or a notification it states the verdict and stops — the reader is
 * told what happened and not what to do about it. The full-page states have
 * always carried a second line for exactly that reason; the banners did not, and
 * a refused save was the commonest place the product answered in two words.
 *
 * The pairing is derived rather than listed: `state.denied.title` is explained by
 * `state.denied.message` when that key exists, and by nothing when it does not.
 * A second table mapping one to the other would be a copy of the catalogue that
 * drifts the first time somebody adds a sentence and forgets it — and drifts
 * silently, because the only symptom is a line that stops appearing.
 *
 * Returns `null`, not the key, when there is no sentence. A missing explanation
 * is an absence the interface can render as nothing; `translate` returns the key
 * so a missing *message* stays visible, but that rule is wrong here, where the
 * common case is a heading that legitimately has no second line.
 */
export function explanationFor(messages: Messages, key: string): string | null {
  if (!key.endsWith(HEADING_SUFFIX)) return null;
  const candidate = `${key.slice(0, -HEADING_SUFFIX.length)}${EXPLANATION_SUFFIX}`;
  const text = messages[candidate as keyof Messages];
  return typeof text === 'string' ? text : null;
}

/** `translateDynamic` followed by `formatMessage`. */
export function translateWithValues(
  messages: Messages,
  key: string,
  values: Readonly<Record<string, string>> | undefined
): string {
  return formatMessage(translateDynamic(messages, key), values);
}
