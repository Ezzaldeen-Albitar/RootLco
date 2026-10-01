import { workOrderStateMessageKey } from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translateDynamic } from '@/i18n/get-messages';
import { formatDayInZone, formatInZone, isCalendarDay, isKnownZone } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';
import { formatMoney, parseMoneyInput } from '@/lib/money';
import type { ReportDefinition, ReportGroup } from './reports-contract';

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

/** An ISO 4217 code as the platform publishes it. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

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

/**
 * A work-order state a report groups or lists by, in the reader's language, or
 * `null` when the code is not one of the platform's states.
 *
 * The server publishes the state's catalogue NAME beside its code, and that name
 * is English whatever the reader's language — an Arabic report listed "Awaiting
 * Customer … Closed" (Browser QA part 7, row 6.7). The code is translated through
 * the same vocabulary the work-order screens use; a code outside it keeps the
 * server's name, which is still a name and never a composed key.
 */
export function reportStateLabel(messages: Messages, code: string | null): string | null {
  if (code === null) return null;
  const key = workOrderStateMessageKey(code);
  return key === null ? null : translateDynamic(messages, key);
}

/**
 * An invoice's credit status (Owner decision D7, ADR-023) in the reader's
 * language, or `null` when the code is not one this build words.
 *
 * The invoice and payment report publishes `none`, `partly_credited` or
 * `credited` as a machine code; it is said with the same words the invoice screen
 * uses, and a code outside that vocabulary falls back to being shown as a code.
 */
export function reportCreditStatusLabel(messages: Messages, code: string | null): string | null {
  if (code === null) return null;
  const key = `invoices.creditStatus.${code}`;
  return resolves(messages, key) ? translateDynamic(messages, key) : null;
}

/**
 * The kind of document an invoice-and-payment row is (`documentType`), in the
 * reader's language, or `null` for a kind this build does not word (finance
 * checkpoint, DF-5). The code — `invoice`, `receipt`, `credit_note` — is the
 * server's discriminator and is never shown as prose.
 */
export function reportDocumentTypeLabel(messages: Messages, code: string | null): string | null {
  if (code === null) return null;
  const key = `reports.documentType.${code}`;
  return resolves(messages, key) ? translateDynamic(messages, key) : null;
}

/** What the party is to the document (`partyRole`: `payer`, `invoice_payer`), or `null`. */
export function reportPartyRoleLabel(messages: Messages, code: string | null): string | null {
  if (code === null) return null;
  const key = `reports.partyRole.${code}`;
  return resolves(messages, key) ? translateDynamic(messages, key) : null;
}

/**
 * The vocabulary each document kind's `status` is said in: the invoice's own
 * status, the receipt's, and the credit note's approval state — the same words
 * the invoice, payment and credit-note screens use, so a status reads the same
 * on the report as on the record it drills through to.
 */
const STATUS_NAMESPACE_BY_DOCUMENT: Readonly<Record<string, string>> = Object.freeze({
  invoice: 'invoices.status',
  receipt: 'payments.status',
  credit_note: 'creditNotes.state',
});

/**
 * A document's `status` in the reader's language, chosen by its `documentType`,
 * or `null` when either code is outside the vocabulary this build words (the
 * caller then shows the code as a code).
 */
export function reportDocumentStatusLabel(
  messages: Messages,
  documentType: string | null,
  code: string | null
): string | null {
  if (code === null || documentType === null) return null;
  const namespace = STATUS_NAMESPACE_BY_DOCUMENT[documentType];
  if (namespace === undefined) return null;
  const key = `${namespace}.${code}`;
  return resolves(messages, key) ? translateDynamic(messages, key) : null;
}

/**
 * The name a group is shown under.
 *
 * A group keyed by `state` alone is re-worded, because `state` is a group key
 * whose vocabulary this build holds. A group keyed by a currency AND a document
 * kind (the invoice-and-payment report) is named by the currency the server
 * labelled it with and the kind in words — "JOD · Invoices" — because three
 * groups all called "JOD" would not say which is which (DF-5). Every other label
 * is the server's — a stock code, a technician's name — and is not language to
 * translate.
 */
export function groupDisplayLabel(messages: Messages, group: ReportGroup): string | null {
  const names = Object.keys(group.key);
  if (names.length === 1 && names[0] === 'state') {
    return reportStateLabel(messages, group.key['state'] ?? null) ?? group.label;
  }
  if (group.label !== null && 'documentType' in group.key) {
    const code = group.key['documentType'] ?? null;
    const key = code === null ? null : `reports.groups.documentType.${code}`;
    if (key !== null && resolves(messages, key)) {
      return `${group.label} · ${translateDynamic(messages, key)}`;
    }
  }
  return group.label;
}

/**
 * The currency a group's measures are amounts in, or `null`.
 *
 * A group keyed by `currency` is a money group: the invoice-and-payment report
 * keys every group on the currency precisely because no amount is comparable
 * across two currencies, and every measure such a group carries is an amount in
 * it (`report-datasets.ts`). No other registered report keys a group on a
 * currency, so a count or a duration is never mistaken for money.
 */
export function groupCurrency(group: ReportGroup): string | null {
  const currency = group.key['currency'] ?? null;
  return currency !== null && CURRENCY_CODE.test(currency) ? currency : null;
}

/**
 * A money cell or measure for reading: the server's exact decimal string,
 * written with its currency's minor unit (`formatMoney` — 3 decimals for JOD,
 * never rounding a digit below it away) and the currency code (DF-6). A value
 * that is not a canonical amount, or that arrives with no currency beside it, is
 * shown exactly as it arrived rather than guessed at.
 */
export function formatReportMoney(value: string, currency: string | null, locale: Locale): string {
  if (currency === null || !CURRENCY_CODE.test(currency) || !parseMoneyInput(value).ok) {
    return value;
  }
  return formatMoney({ amount: value, currency }, intlLocale(locale));
}

/**
 * A report date or instant for reading, on the REPORTED branch's clock.
 *
 * The period is resolved in the branch's zone (D-17), so an instant is drawn on
 * that same clock and never on the browser's — a row counted into "the 3rd in
 * Amman" stays under the 3rd for a reader sitting elsewhere. A calendar day is a
 * day and is not shifted. A zone the browser does not know falls back to UTC,
 * and a value that is not a date at all is shown exactly as it arrived.
 */
export function formatReportTime(value: string, locale: Locale, zone: string): string {
  const intl = intlLocale(locale);
  const clock = isKnownZone(zone) ? zone : 'UTC';
  if (isCalendarDay(value)) return formatDayInZone(value, intl, clock);
  if (Number.isNaN(new Date(value).getTime())) return value;
  return formatInZone(value, intl, clock);
}
