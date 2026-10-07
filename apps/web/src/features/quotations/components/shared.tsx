'use client';

import { useCallback, useId, useRef, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import { regexes } from 'zod';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { FormMoneyField } from '@/components/forms/mui/FormMoneyField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { EntityPicker } from '@/components/pickers/EntityPicker';
import { listItems, listUnitsOfMeasure } from '@/features/inventory/api';
import {
  MAX_NAME,
  MIN_ITEM_SEARCH,
  type InventoryItem,
} from '@/features/inventory/inventory-contract';
import { ServicePicker } from '@/features/pricing/components/shared';
import { directionOf, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { formatDayInZone, isCalendarDay } from '@/lib/branch-time';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime, intlLocale } from '@/lib/format';
import { formatMoney } from '@/lib/money';

import type { QuotationLineBody } from '@/lib/contracts/quotations-contract';
import {
  DISCOUNT,
  MAX_ITEM_DESCRIPTION,
  MAX_ITEMS_PER_REVISION,
  QUANTITY,
  type QuotationLine,
  type QuotationRevision,
  type QuotationState,
  type RevisionState,
} from '../quotations-contract';

/**
 * Pieces the two quotation screens share (P1-30, `W3`), on the shared Material
 * UI wrappers since the sales and finance slice (ADR-022).
 *
 * Money is rendered through `formatMoney` from the strings the server sent;
 * quantities and tax rates are rendered verbatim — they are decimal strings
 * too, and a quantity is not a thing this screen multiplies by anything.
 */

/**
 * An identifier exactly as the server's `z.string().uuid()` accepts it — zod's own
 * pattern, not a copy: an RFC 9562 version digit (1-8) and variant (8, 9, a or b),
 * or the all-zero and all-f identifiers zod also admits. A looser 8-4-4-4-12 hex
 * check passed values the route then refused, so the box said nothing and the
 * submit failed on the server instead.
 */
export const UUID = regexes.uuid();

/**
 * A moment, in the reader's language AND the reader's direction.
 *
 * The Arabic date format carries right-to-left marks between its parts, so a
 * formatted Arabic moment boxed as left to right is re-ordered by the browser —
 * on paper the day jumped to the end of the line (checkpoint browser QA,
 * OBS-3). The moment is isolated (`<bdi>`) in the direction of the language it
 * was formatted in, so it reads in order in both, on screen and on paper.
 */
export function When({ value, locale }: { readonly value: string; readonly locale: Locale }) {
  return <bdi dir={directionOf(locale)}>{formatDateTime(value, locale)}</bdi>;
}

/**
 * A calendar day (`YYYY-MM-DD`), written as a person writes it in the reader's
 * language, and isolated in that language's direction for the reason `When`
 * gives. A day names no instant, so it is placed on no clock but its own.
 */
export function Day({ value, locale }: { readonly value: string; readonly locale: Locale }) {
  if (!isCalendarDay(value)) return <bdi dir="ltr">{value}</bdi>;
  return <bdi dir={directionOf(locale)}>{formatDayInZone(value, intlLocale(locale), 'UTC')}</bdi>;
}

/* ------------------------------------------------------------------ *
 * Badges, notes, figures
 * ------------------------------------------------------------------ */

export function QuotationStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: QuotationState;
}) {
  const label = translateDynamic(messages, `quotations.status.${status}`);
  if (status === 'accepted') {
    return (
      <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-medium text-on-primary">
        {label}
      </span>
    );
  }
  if (status === 'draft' || status === 'active') return <span className="text-body">{label}</span>;
  return (
    <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
      {label}
    </span>
  );
}

export function RevisionStatusBadge({
  messages,
  status,
}: {
  readonly messages: Messages;
  readonly status: RevisionState;
}) {
  const label = translateDynamic(messages, `quotations.revisionStatus.${status}`);
  if (status === 'issued') {
    return (
      <span className="rounded-md bg-primary px-2 py-0.5 text-caption font-medium text-on-primary">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border px-2 py-0.5 text-caption text-text-secondary">
      {label}
    </span>
  );
}

/** A failed outcome beside the form that caused it, with its reference. */
export function OutcomeNote({
  messages,
  outcome,
  hintKey,
}: {
  readonly messages: Messages;
  readonly outcome: ActionState | null;
  /** An extra sentence for a denial — the discount refusal renders as a refusal, with this hint. */
  readonly hintKey?: string | undefined;
}) {
  if (!outcome || outcome.status === 'idle' || outcome.status === 'success') return null;
  const key = outcome.messageKey ?? 'action.failed';
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, key)}
      {hintKey && outcome.status === 'denied' ? ` ${translateDynamic(messages, hintKey)}` : null}
      {outcome.correlationId ? (
        <>
          {' '}
          <span className="text-caption text-text-muted">
            {translate(messages, 'state.correlationId')}{' '}
            <code className="font-mono" dir="ltr">
              {outcome.correlationId}
            </code>
          </span>
        </>
      ) : null}
    </p>
  );
}

/** A `dt`/`dd` pair for a read-only figure. */
export function Figure({
  label,
  wide,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}

/**
 * A money figure, as the server stated it, with its ISO code, written at the
 * currency's minor unit (`formatMoney`, Owner decision D1): three decimals for
 * JOD, none for JPY, and never fewer than the amount's own significant digits.
 *
 * `minorUnit` is the server's count of decimals where a read publishes one. No
 * quotation read publishes it today, so `formatMoney` takes the currency's minor
 * unit from the browser's own currency data (`Intl`) — the same fallback every
 * other screen uses for an amount whose read did not say.
 */
export function Money({
  amount,
  currency,
  minorUnit,
  locale,
}: {
  readonly amount: string;
  readonly currency: string;
  readonly minorUnit?: number | undefined;
  readonly locale: Locale;
}) {
  return (
    <span className="font-mono" dir="ltr">
      {formatMoney({ amount, currency, minorUnit }, locale)}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * A revision's lines and totals — the captured figures
 * ------------------------------------------------------------------ */

export function LinesTable({
  locale,
  messages,
  lines,
  caption,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly lines: readonly QuotationLine[];
  readonly caption: string;
}) {
  if (lines.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'quotations.lines.none')}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-caption text-text-muted">
            <th scope="col" className="py-1 pe-3 text-start">
              {translate(messages, 'quotations.lines.column.number')}
            </th>
            <th scope="col" className="py-1 pe-3 text-start">
              {translate(messages, 'quotations.lines.column.item')}
            </th>
            <th scope="col" className="py-1 pe-3 text-end">
              {translate(messages, 'quotations.lines.column.unitPrice')}
            </th>
            <th scope="col" className="py-1 pe-3 text-end">
              {translate(messages, 'quotations.lines.column.quantity')}
            </th>
            <th scope="col" className="py-1 pe-3 text-end">
              {translate(messages, 'quotations.lines.column.discount')}
            </th>
            <th scope="col" className="py-1 pe-3 text-end">
              {translate(messages, 'quotations.lines.column.taxRate')}
            </th>
            <th scope="col" className="py-1 pe-3 text-end">
              {translate(messages, 'quotations.lines.column.taxAmount')}
            </th>
            <th scope="col" className="py-1 text-end">
              {translate(messages, 'quotations.lines.column.lineTotal')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-border">
              <td className="py-2 pe-3">
                <code className="font-mono" dir="ltr">
                  {line.lineNumber}
                </code>
              </td>
              <td className="py-2 pe-3">
                <span className="flex flex-col">
                  <span className="text-caption text-text-muted">
                    {translateDynamic(messages, `quotations.itemKind.${line.itemKind}`)}
                  </span>
                  {line.item ? (
                    // The part as it was quoted (ADR-023 D6): its name, and its stock
                    // code isolated left to right so an Arabic page keeps its order.
                    <span>
                      <bdi>{line.item.name}</bdi>{' '}
                      <span className="font-mono text-caption text-text-muted" dir="ltr">
                        {line.item.code}
                      </span>
                    </span>
                  ) : null}
                  {line.description ? <bdi>{line.description}</bdi> : null}
                </span>
              </td>
              <td className="py-2 pe-3 text-end">
                <Money amount={line.unitPrice} currency={line.currency} locale={locale} />
              </td>
              <td className="py-2 pe-3 text-end">
                <code className="font-mono" dir="ltr">
                  {line.quantity}
                </code>
                {line.unit ? (
                  <>
                    {' '}
                    <bdi className="text-caption text-text-muted">{line.unit.name}</bdi>
                  </>
                ) : null}
              </td>
              <td className="py-2 pe-3 text-end">
                <Money amount={line.discount} currency={line.currency} locale={locale} />
              </td>
              <td className="py-2 pe-3 text-end">
                <code className="font-mono" dir="ltr">
                  {line.taxRate}
                </code>
              </td>
              <td className="py-2 pe-3 text-end">
                <Money amount={line.taxAmount} currency={line.currency} locale={locale} />
              </td>
              <td className="py-2 text-end">
                <Money amount={line.lineTotal} currency={line.currency} locale={locale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The four captured totals of a revision, as stated.
 *
 * `quo.issue_revision` is what captures them: until a revision is issued the
 * four columns hold their database default of zero, which is not a figure of
 * the quotation. So a draft says that its totals are captured on issue and
 * prints no figure at all — printing `0.0000` under "Total" would be the
 * server's placeholder dressed up as an amount.
 */
export function TotalsList({
  locale,
  messages,
  revision,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly revision: Pick<
    QuotationRevision,
    'subtotal' | 'discountTotal' | 'taxTotal' | 'grandTotal' | 'currency' | 'status'
  >;
}) {
  if (revision.status === 'draft') {
    return (
      <p className="text-body text-text-secondary">
        {translate(messages, 'quotations.totals.draftNote')}
      </p>
    );
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      <Figure label={translate(messages, 'quotations.totals.subtotal')}>
        <Money amount={revision.subtotal} currency={revision.currency} locale={locale} />
      </Figure>
      <Figure label={translate(messages, 'quotations.totals.discount')}>
        <Money amount={revision.discountTotal} currency={revision.currency} locale={locale} />
      </Figure>
      <Figure label={translate(messages, 'quotations.totals.tax')}>
        <Money amount={revision.taxTotal} currency={revision.currency} locale={locale} />
      </Figure>
      <Figure label={translate(messages, 'quotations.totals.grand')}>
        <strong>
          <Money amount={revision.grandTotal} currency={revision.currency} locale={locale} />
        </strong>
      </Figure>
    </dl>
  );
}

/* ------------------------------------------------------------------ *
 * The lines editor — what the builder sends; the server prices it
 * ------------------------------------------------------------------ */

/** What a line quotes: a service, or a part from the item catalogue (ADR-023 D6). */
export type LineKind = 'service' | 'part';

/**
 * A part as the line editor holds it once chosen: its words and the unit it is
 * counted in, by the unit's NAME — the word the quotation and invoice tables show
 * for the same unit once the line is saved.
 */
export interface ChosenPart {
  readonly id: string;
  readonly label: string;
  readonly unitName: string;
}

export interface DraftLine {
  readonly key: number;
  readonly kind: LineKind;
  readonly serviceId: string;
  /** The part chosen for a part line; `null` until one is chosen. */
  readonly item: ChosenPart | null;
  readonly quantity: string;
  readonly discount: string;
  readonly discountValid: boolean;
  readonly description: string;
}

let lineKey = 0;
export const newLine = (): DraftLine => ({
  key: ++lineKey,
  kind: 'service',
  serviceId: '',
  item: null,
  quantity: '',
  discount: '',
  discountValid: true,
  description: '',
});

/**
 * Validates the draft lines; returns the bodies to send, or the errors keyed by
 * `line-<key>-<field>`.
 *
 * A line with no service says so in the words of the control the operator has:
 * "find the service and choose it" beside the service search, "this field is
 * required" beside the reference box a caller without the catalogue read keeps.
 * A reference that is not one is refused before anything is sent.
 */
export function validateLines(
  lines: readonly DraftLine[],
  canReadServices = true
): {
  readonly bodies: QuotationLineBody[];
  readonly errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const bodies: QuotationLineBody[] = [];
  if (lines.length === 0) errors['lines'] = 'quotations.lines.atLeastOne';
  if (lines.length > MAX_ITEMS_PER_REVISION) errors['lines'] = 'quotations.lines.tooMany';
  for (const line of lines) {
    const serviceId = line.serviceId.trim();
    if (line.kind === 'part') {
      // A part is found and chosen, never typed: the server prices it from the
      // item's selling price, so the line names the item and nothing else.
      if (line.item === null) errors[`line-${line.key}-itemId`] = 'quotations.lines.itemRequired';
    } else if (serviceId.length === 0) {
      errors[`line-${line.key}-serviceId`] = canReadServices
        ? 'pricing.picker.serviceRequired'
        : 'field.required';
    } else if (!UUID.test(serviceId)) {
      errors[`line-${line.key}-serviceId`] = 'pricing.picker.serviceReferenceFormat';
    }
    const quantity = line.quantity.trim();
    if (!QUANTITY.test(quantity) || /^0(?:\.0+)?$/.test(quantity)) {
      errors[`line-${line.key}-quantity`] = 'quotations.lines.quantityFormat';
    }
    const discount = line.discount.trim();
    if (discount.length > 0 && (!line.discountValid || !DISCOUNT.test(discount))) {
      errors[`line-${line.key}-discount`] = 'quotations.lines.discountFormat';
    }
    const description = line.description.trim();
    if (description.length > MAX_ITEM_DESCRIPTION) {
      errors[`line-${line.key}-description`] = 'quotations.lines.descriptionTooLong';
    }
    bodies.push({
      ...(line.kind === 'part'
        ? { kind: 'part' as const, itemId: line.item?.id ?? '' }
        : { serviceId }),
      quantity,
      ...(discount ? { discount } : {}),
      ...(description ? { description } : {}),
    });
  }
  return { bodies, errors };
}

/**
 * The current value behind every complaint `validateLines` can make, keyed the
 * same way, so a form's own refusal can withdraw a complaint once its line
 * changes (route sweep B3). `lines` stands for the number of lines.
 */
export function lineValues(lines: readonly DraftLine[]): Record<string, string> {
  const values: Record<string, string> = { lines: String(lines.length) };
  for (const line of lines) {
    values[`line-${line.key}-serviceId`] = line.serviceId;
    values[`line-${line.key}-itemId`] = line.item?.id ?? '';
    values[`line-${line.key}-quantity`] = line.quantity;
    values[`line-${line.key}-discount`] = line.discount;
    values[`line-${line.key}-description`] = line.description;
  }
  return values;
}

/**
 * The line errors to render, with the server's line refusal folded in.
 *
 * The API refuses a line against `body.lines[<n>].quantity`, and the browser
 * keeps only the LEAF of that path — so what arrives is one entry named
 * `quantity`, with the line it belongs to no longer in it. The controls here are
 * keyed `line-<key>-quantity` by a draft key the server never saw, so the
 * sentence matched no control and was rendered by nothing at all.
 *
 * It is filed under `lines` instead: the alert the editor already draws above
 * the lines, which is the narrowest place this refusal can honestly be shown.
 * Pointing at one line would be a guess, and guessing the wrong line is worse
 * than naming none. A line error the operator's own draft already produced wins,
 * because that one does know its line.
 *
 * A discount refused against `body.lines[<n>].discount` is different: a fixed
 * discount finer than the quotation currency's minor unit (ADR-023, D1) is only
 * knowable once the server has priced the lines, and the adapter keeps its
 * line's position (`lines.<n>.discount`). The builder places it on that line's
 * discount box through `serverLineRefusals`, so it is not repeated here. Only
 * a bare `discount` with no position is folded above the lines.
 */
export function lineErrors(
  own: Readonly<Record<string, string>>,
  outcome: ActionState | null
): Readonly<Record<string, string>> {
  const published = outcome?.fieldErrors ?? {};
  const placed = Object.keys(published).some((field) => LINE_FIELD.test(field));
  const folded = published['quantity'] ?? (placed ? undefined : published['discount']);
  if (folded === undefined || own['lines'] !== undefined) return own;
  return { ...own, lines: folded };
}

/**
 * `lines.<n>.<field>`: a refused discount or part with its line's position
 * (quotations `api.ts`). A part line's item is refused there when it has no
 * selling price for the branch (ADR-023 D6) — only the server knows that.
 */
const LINE_FIELD = /^lines\.(\d+)\.(discount|itemId)$/;

/**
 * A server refusal of a line's discount, keyed to the control that holds it.
 *
 * The API names the line by its position in the body it was sent, and the
 * body's lines are the draft lines in order (`validateLines`), so position
 * `<n>` is `lines[n]` of the draft that was submitted. The result is keyed
 * `line-<key>-discount`, the key the discount box reads, so the caller can
 * record it as the form's own refusal: the box turns red with the sentence
 * beside it and `aria-invalid`, the cursor moves to it, and the complaint is
 * withdrawn once the discount is corrected (ADR-023, D1).
 */
export function serverLineRefusals(
  submitted: readonly DraftLine[],
  state: ActionState
): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [field, key] of Object.entries(state.fieldErrors ?? {})) {
    const match = LINE_FIELD.exec(field);
    if (match === null) continue;
    const line = submitted[Number(match[1])];
    if (line !== undefined) found[`line-${line.key}-${match[2]}`] = key;
  }
  return found;
}

/** Whether a draft line holds anything the operator typed or chose. */
function lineTouched(line: DraftLine): boolean {
  return (
    line.serviceId.trim().length > 0 ||
    line.item !== null ||
    line.quantity.trim().length > 0 ||
    line.discount.trim().length > 0 ||
    line.description.trim().length > 0
  );
}

/**
 * Whether the lines hold work the operator would lose: more than the one empty
 * line a builder opens with, or anything typed or chosen in a line.
 */
export function linesDirty(lines: readonly DraftLine[]): boolean {
  return lines.length !== 1 || lines.some(lineTouched);
}

/**
 * The lines a builder sends, on the shared Material UI fields (ADR-022).
 *
 * A service is FOUND through the catalogue search the pricing screens use
 * (`ServicePicker`, the shared combobox) when the operator holds
 * `svc.service.read`, and named by the reference box it always had when they do
 * not. The quantity is a text box with a numeric keypad and the discount a money
 * field in the document's currency, both kept as the strings typed; nothing is
 * priced here. Every control carries its own error, and correcting a field
 * withdraws the complaint (the caller's `useLocalRefusal`).
 */
export function LinesEditor({
  messages,
  locale,
  currency,
  lines,
  onChange,
  canReadServices,
  canReadItems = false,
  errors,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  /** The document's currency, once known; the first line decides it on the server. */
  readonly currency: string | null;
  readonly lines: readonly DraftLine[];
  readonly onChange: (next: readonly DraftLine[]) => void;
  readonly canReadServices: boolean;
  /**
   * `inv.item.read` — whether a line may quote a PART (ADR-023 D6). The part is
   * found in the item catalogue, which needs that read; without it every line is
   * the service line it always was and nothing on the form changes.
   */
  readonly canReadItems?: boolean;
  readonly errors: Readonly<Record<string, string>>;
}) {
  const errorFor = (key: string): string | undefined => {
    const found = errors[key];
    return found ? translateDynamic(messages, found) : undefined;
  };
  // The part help names the unit and how the part is priced; the part box points
  // at it (`aria-describedby`), so a screen reader hears it with the box.
  const helpBase = useId();
  const partHelpId = (key: number) => `${helpBase}-line-${key}-part-help`;
  const update = (key: number, patch: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.lines.heading')}
      </legend>
      <p className="text-caption text-text-muted">
        {/* A line quotes a service or, for a holder of the item read, a part. */}
        {translate(
          messages,
          canReadItems ? 'quotations.lines.explain' : 'quotations.lines.explainServices'
        )}
        {canReadItems ? ` ${translate(messages, 'quotations.lines.partsExplain')}` : null}
      </p>
      {errorFor('lines') ? (
        <p role="alert" className="text-body text-error">
          {errorFor('lines')}
        </p>
      ) : null}
      {lines.map((line, index) => (
        <div
          key={line.key}
          role="group"
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
          aria-label={`${translate(messages, 'quotations.lines.one')} ${index + 1}`}
        >
          {canReadItems ? (
            <div className="sm:col-span-2">
              <FormRadioGroupField
                label={translate(messages, 'quotations.lines.kind')}
                value={line.kind}
                onChange={(kind) =>
                  update(line.key, { kind: kind === 'part' ? 'part' : 'service' })
                }
                options={[
                  { value: 'service', label: translate(messages, 'quotations.lines.kindService') },
                  { value: 'part', label: translate(messages, 'quotations.lines.kindPart') },
                ]}
                testId={`quotation-line-${index + 1}-kind`}
              />
            </div>
          ) : null}
          <div className="sm:col-span-2">
            {line.kind === 'part' ? (
              <PartPicker
                messages={messages}
                locale={locale}
                label={translate(messages, 'quotations.picker.item')}
                value={line.item}
                onChange={(item) => update(line.key, { item })}
                error={errorFor(`line-${line.key}-itemId`)}
                describedBy={partHelpId(line.key)}
                testId={`quotation-line-${index + 1}-part`}
              />
            ) : (
              <ServicePicker
                messages={messages}
                locale={locale}
                canRead={canReadServices}
                label={translate(messages, 'quotations.picker.service')}
                value={line.serviceId}
                onChange={(serviceId) => update(line.key, { serviceId })}
                error={errorFor(`line-${line.key}-serviceId`)}
                testId={`quotation-line-${index + 1}-service`}
              />
            )}
            {line.kind === 'part' ? (
              <p id={partHelpId(line.key)} className="mt-1 text-caption text-text-muted">
                {line.item ? (
                  <>
                    {withIsolatedValue(
                      translate(messages, 'quotations.lines.partUnit'),
                      'unit',
                      line.item.unitName
                    )}{' '}
                  </>
                ) : null}
                {translate(messages, 'quotations.lines.partPriceHelp')}
              </p>
            ) : null}
          </div>
          <FormTextField
            label={translate(messages, 'quotations.lines.quantity')}
            description={translate(
              messages,
              line.kind === 'part'
                ? 'quotations.lines.partQuantityHelp'
                : 'quotations.lines.quantityHelp'
            )}
            required
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            value={line.quantity}
            onChange={(quantity) => update(line.key, { quantity })}
            error={errorFor(`line-${line.key}-quantity`)}
          />
          <FormMoneyField
            messages={messages}
            label={translate(messages, 'quotations.lines.discount')}
            description={translate(messages, 'quotations.lines.discountHelp')}
            currency={currency ?? '—'}
            value={line.discount}
            onChange={(next, valid) => update(line.key, { discount: next, discountValid: valid })}
            error={errorFor(`line-${line.key}-discount`)}
          />
          <div className="sm:col-span-2">
            <FormTextField
              label={translate(messages, 'quotations.lines.description')}
              multiline
              rows={2}
              value={line.description}
              onChange={(description) => update(line.key, { description })}
              error={errorFor(`line-${line.key}-description`)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="outlined"
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((entry) => entry.key !== line.key))}
            >
              {translate(messages, 'quotations.lines.remove')}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outlined"
          disabled={lines.length >= MAX_ITEMS_PER_REVISION}
          onClick={() => onChange([...lines, newLine()])}
        >
          {translate(messages, 'quotations.lines.add')}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * One part of the item catalogue, found by the start of its stock code or its
 * name (`inv.item-search`, active items only — an archived item cannot be quoted)
 * and chosen by what it says, on the shared Material picker (ADR-022). It is only
 * rendered where the operator holds `inv.item.read` (`LinesEditor`), and it
 * carries no price: the server prices the part at its selling price for the
 * branch. The unit the item is counted in is kept with the choice, so the line
 * can say what its quantity is in. The surrounding form declares its own unsaved
 * work, so the picker does not.
 */
export function PartPicker({
  messages,
  locale,
  label,
  value,
  onChange,
  error,
  describedBy,
  testId,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly label: string;
  readonly value: ChosenPart | null;
  readonly onChange: (next: ChosenPart | null) => void;
  readonly error?: string | undefined;
  /** The id of the text that explains the box — the line's unit and pricing note. */
  readonly describedBy?: string | undefined;
  readonly testId: string;
}) {
  // The unit NAMES, read once per picker from the unit list (`inv.uom-list`, under the
  // same `inv.item.read` the part search needs), because a catalogue row carries only
  // its unit's code. A failed read is not kept, so the next search asks again; until
  // one answers, a part says its unit's code rather than nothing.
  const unitNames = useRef<Promise<ReadonlyMap<string, string>> | null>(null);
  const load = useCallback(
    async (term: string, cursor: string | null): Promise<ReadState<CursorPage<ChosenPart>>> => {
      unitNames.current ??= listUnitsOfMeasure().then(
        (state): ReadonlyMap<string, string> => {
          if (state.status === 'ok') {
            return new Map(state.data.items.map((unit) => [unit.id, unit.name] as const));
          }
          unitNames.current = null;
          return new Map();
        },
        (): ReadonlyMap<string, string> => {
          unitNames.current = null;
          return new Map();
        }
      );
      const [page, names] = await Promise.all([
        listItems(
          { search: term, lifecycleStatus: 'active' },
          { ...INITIAL_REQUEST, pageSize: 10 },
          cursor
        ),
        unitNames.current,
      ]);
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: {
          items: page.rows.map((row) => chosenPartOf(row, names)),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
        },
        correlationId: page.correlationId,
      };
    },
    []
  );
  return (
    <EntityPicker<ChosenPart>
      messages={messages}
      locale={locale}
      label={label}
      value={value}
      onChange={onChange}
      labelOf={(part) => part.label}
      load={load}
      canSearch
      notPermitted={translate(messages, 'inventory.itemPicker.notPermitted')}
      error={error}
      minLength={MIN_ITEM_SEARCH}
      maxLength={MAX_NAME}
      placeholder={translate(messages, 'inventory.itemPicker.searchPlaceholder')}
      example={translate(messages, 'inventory.itemPicker.searchExample')}
      tooShort={translate(messages, 'inventory.itemPicker.tooShort')}
      resultsLabel={translate(messages, 'inventory.itemPicker.results')}
      change={translate(messages, 'inventory.itemPicker.change')}
      countsAsUnsaved={false}
      describedBy={describedBy}
      testId={testId}
    />
  );
}

/**
 * A catalogue row as a part choice: its stock code and name, and its unit by name
 * (`unitNames`, keyed by unit id), or by its code while the name is not known.
 */
export function chosenPartOf(
  item: InventoryItem,
  unitNames: ReadonlyMap<string, string> = new Map()
): ChosenPart {
  return {
    id: item.id,
    label: `${item.sku} — ${item.name}`,
    unitName: unitNames.get(item.unitOfMeasure.id) ?? item.unitOfMeasure.code,
  };
}

/**
 * A translated sentence with one placeholder filled by text isolated in `<bdi>`, so
 * a value in the other script — a unit named in English inside an Arabic sentence —
 * cannot reorder the punctuation around it. A template without the placeholder is
 * returned as written.
 */
function withIsolatedValue(template: string, name: string, value: string): ReactNode {
  const parts = template.split(`{${name}}`);
  if (parts.length !== 2) return template;
  return (
    <>
      {parts[0]}
      <bdi>{value}</bdi>
      {parts[1]}
    </>
  );
}
