'use client';

import { useMemo, useState } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { MoneyField } from '@/components/forms/MoneyField';
import { listServices } from '@/features/services/api';
import type { ServiceSummary } from '@/features/services/services-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';
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
 * Pieces the two quotation screens share (P1-30, `W3`).
 *
 * Money is rendered through `formatMoney` from the strings the server sent;
 * quantities and tax rates are rendered verbatim — they are decimal strings
 * too, and a quantity is not a thing this screen multiplies by anything.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover';
export const SECONDARY_BUTTON =
  'rounded-md border border-border bg-surface px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard';

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

/** A money figure, as the server stated it, with its ISO code. */
export function Money({
  amount,
  currency,
  locale,
}: {
  readonly amount: string;
  readonly currency: string;
  readonly locale: Locale;
}) {
  return (
    <span className="font-mono" dir="ltr">
      {formatMoney({ amount, currency }, locale)}
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
                  {line.description ? <bdi>{line.description}</bdi> : null}
                  {line.serviceId ? (
                    <code className="font-mono text-caption" dir="ltr">
                      {line.serviceId}
                    </code>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pe-3 text-end">
                <Money amount={line.unitPrice} currency={line.currency} locale={locale} />
              </td>
              <td className="py-2 pe-3 text-end">
                <code className="font-mono" dir="ltr">
                  {line.quantity}
                </code>
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

export interface DraftLine {
  readonly key: number;
  readonly serviceId: string;
  readonly quantity: string;
  readonly discount: string;
  readonly discountValid: boolean;
  readonly description: string;
}

let lineKey = 0;
export const newLine = (): DraftLine => ({
  key: ++lineKey,
  serviceId: '',
  quantity: '',
  discount: '',
  discountValid: true,
  description: '',
});

/** Validates the draft lines; returns the bodies to send, or the errors keyed by `line-<key>-<field>`. */
export function validateLines(lines: readonly DraftLine[]): {
  readonly bodies: QuotationLineBody[];
  readonly errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const bodies: QuotationLineBody[] = [];
  if (lines.length === 0) errors['lines'] = 'quotations.lines.atLeastOne';
  if (lines.length > MAX_ITEMS_PER_REVISION) errors['lines'] = 'quotations.lines.tooMany';
  for (const line of lines) {
    const serviceId = line.serviceId.trim();
    if (!UUID.test(serviceId)) errors[`line-${line.key}-serviceId`] = 'quotations.common.idFormat';
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
      serviceId,
      quantity,
      ...(discount ? { discount } : {}),
      ...(description ? { description } : {}),
    });
  }
  return { bodies, errors };
}

/**
 * A service, found by the beginning of its code or name when the operator
 * holds `svc.service.read`, and named by identifier when they do not.
 */
export function ServicePicker({
  messages,
  canRead,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  readonly canRead: boolean;
  readonly value: string;
  readonly onChange: (serviceId: string) => void;
  readonly error?: string | undefined;
}) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<readonly ServiceSummary[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const needle = term.trim();
    setBusy(true);
    const page = await listServices(needle ? { search: needle } : {}, INITIAL_REQUEST, null);
    setBusy(false);
    if (page.status === 'ok') {
      setFound(page.rows);
      setNote(page.rows.length === 0 ? 'quotations.picker.noServices' : null);
    } else {
      setFound(null);
      setNote(
        page.status === 'denied'
          ? 'quotations.picker.servicesRefused'
          : 'quotations.picker.searchFailed'
      );
    }
  };

  const options = useMemo(
    () =>
      (found ?? []).map((service) => ({
        value: service.id,
        label: `${service.serviceCode} — ${service.name}`,
      })),
    [found]
  );

  if (!canRead) {
    return (
      <TextField
        label={translate(messages, 'quotations.picker.serviceIdField')}
        description={translate(messages, 'quotations.picker.servicesNotReadable')}
        required
        spellCheck={false}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={error}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="grow">
          <TextField
            label={translate(messages, 'quotations.picker.serviceSearch')}
            spellCheck={false}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={() => {
            void search();
          }}
        >
          {translate(messages, 'quotations.picker.search')}
        </button>
      </div>
      <SelectField
        label={translate(messages, 'quotations.picker.service')}
        required
        {...(note ? { description: translateDynamic(messages, note) } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
        placeholder={translate(messages, 'quotations.picker.chooseService')}
        error={error}
      />
    </div>
  );
}

export function LinesEditor({
  messages,
  currency,
  lines,
  onChange,
  canReadServices,
  errors,
}: {
  readonly messages: Messages;
  /** The document's currency, once known; the first line decides it on the server. */
  readonly currency: string | null;
  readonly lines: readonly DraftLine[];
  readonly onChange: (next: readonly DraftLine[]) => void;
  readonly canReadServices: boolean;
  readonly errors: Readonly<Record<string, string>>;
}) {
  const errorFor = (key: string): string | undefined => {
    const found = errors[key];
    return found ? translateDynamic(messages, found) : undefined;
  };
  const update = (key: number, patch: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.lines.heading')}
      </legend>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.lines.explain')}
      </p>
      {errorFor('lines') ? (
        <p role="alert" className="text-body text-error">
          {errorFor('lines')}
        </p>
      ) : null}
      {lines.map((line, index) => (
        <div
          key={line.key}
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
          aria-label={`${translate(messages, 'quotations.lines.one')} ${index + 1}`}
        >
          <div className="sm:col-span-2">
            <ServicePicker
              messages={messages}
              canRead={canReadServices}
              value={line.serviceId}
              onChange={(serviceId) => update(line.key, { serviceId })}
              error={errorFor(`line-${line.key}-serviceId`)}
            />
          </div>
          <TextField
            label={translate(messages, 'quotations.lines.quantity')}
            description={translate(messages, 'quotations.lines.quantityHelp')}
            required
            inputMode="decimal"
            dir="ltr"
            value={line.quantity}
            onChange={(event) => update(line.key, { quantity: event.target.value })}
            error={errorFor(`line-${line.key}-quantity`)}
          />
          <MoneyField
            messages={messages}
            label={translate(messages, 'quotations.lines.discount')}
            description={translate(messages, 'quotations.lines.discountHelp')}
            currency={currency ?? '—'}
            value={line.discount}
            onChange={(next, valid) => update(line.key, { discount: next, discountValid: valid })}
            error={errorFor(`line-${line.key}-discount`)}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label={translate(messages, 'quotations.lines.description')}
              value={line.description}
              onChange={(event) => update(line.key, { description: event.target.value })}
              error={errorFor(`line-${line.key}-description`)}
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={lines.length === 1}
              onClick={() => onChange(lines.filter((entry) => entry.key !== line.key))}
            >
              {translate(messages, 'quotations.lines.remove')}
            </button>
          </div>
        </div>
      ))}
      <div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={lines.length >= MAX_ITEMS_PER_REVISION}
          onClick={() => onChange([...lines, newLine()])}
        >
          {translate(messages, 'quotations.lines.add')}
        </button>
      </div>
    </fieldset>
  );
}
