import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import type { ReportDefinition } from './reports-contract';

/**
 * How a report, a column and a measure are NAMED on screen.
 *
 * Every name a report publishes is a machine name: a report code, a column key,
 * a measure key. None of them is language, and none of them may be shown to a
 * receptionist as though it were — `work_orders_by_status` is an identifier, and
 * the plain-language rule this product is held to refuses exactly that shape in
 * the message catalogue.
 *
 * So a name is resolved in one place, with one rule, and the rule has three
 * branches rather than two:
 *
 *  1. **A platform baseline carries a translation KEY** (`titleKey`) rather than
 *     a label, because a baseline has no operator who could have written one and
 *     the platform must not ship an English string as though a workshop had
 *     named the report. If the catalogue holds that key, its message is the name.
 *  2. **A tenant configuration carries `name`** — that operator's own words, in
 *     whatever language they wrote them. It is shown as written and never
 *     translated, because translating somebody's own label is inventing one.
 *  3. **Neither resolves.** The code is shown AS A CODE — monospaced, left to
 *     right, visibly an identifier — rather than dressed up as a sentence. This
 *     is the case for a registered report this build has no message for yet, and
 *     the work-order board takes the same position on workshop-owned state codes
 *     for the same reason: a translation table keyed on names somebody else owns
 *     is a second, rotting copy of their configuration.
 *
 * `translateDynamic` returns the key itself when a message is missing, which is
 * what makes branch 3 detectable rather than silently rendering a dotted key
 * into the middle of a table.
 */

/** Whether the catalogue actually holds a message for a runtime-built key. */
function resolves(messages: Messages, key: string): boolean {
  return translateDynamic(messages, key) !== key;
}

/**
 * The name to display for a report, or `null` when only its code can be shown.
 *
 * `null` is a real answer and the caller renders it as a code. Returning the
 * code from here instead would make a caller unable to tell a NAME from an
 * IDENTIFIER, and it would then style the identifier as prose.
 */
export function reportTitle(messages: Messages, definition: ReportDefinition): string | null {
  if (definition.titleKey !== null && resolves(messages, definition.titleKey)) {
    return translateDynamic(messages, definition.titleKey);
  }
  // A tenant row's `name` is the operator's own label. A baseline's `name`
  // repeats the CODE, which is why it is only used when a key is absent — the
  // catalogue service says so in its own projection.
  if (definition.titleKey === null && definition.name.length > 0) return definition.name;
  return null;
}

/** The name to display for a report title the run envelope published by key. */
export function runTitle(messages: Messages, titleKey: string): string | null {
  return resolves(messages, titleKey) ? translateDynamic(messages, titleKey) : null;
}

/**
 * The heading for a column, a measure or a group key, or `null`.
 *
 * One namespace for all three, because they name the same things: the invoice and
 * payment report's `currency` is a group key and a column, and two message keys
 * for one word would be free to disagree.
 */
export function fieldHeading(messages: Messages, key: string): string | null {
  const messageKey = `reports.field.${key}`;
  return resolves(messages, messageKey) ? translateDynamic(messages, messageKey) : null;
}
