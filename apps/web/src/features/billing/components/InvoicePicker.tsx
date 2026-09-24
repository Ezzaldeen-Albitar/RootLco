'use client';

import { useCallback } from 'react';

import { SearchPicker } from '@/components/search/SearchPicker';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import { listInvoices } from '../api';
import {
  MAX_INVOICE_SEARCH,
  MIN_INVOICE_SEARCH,
  type InvoiceListEntry,
  type InvoiceStatus,
} from '../billing-contract';

/**
 * One invoice of a branch, FOUND by its number, its payer's name or the plate
 * of the job's vehicle, and chosen by what it says — never typed as a reference
 * (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * `sal.invoice-list` requires the company AND the branch, and so does this
 * picker: an allocation cannot cross a branch boundary, so the caller passes the
 * branch the receipt belongs to rather than whatever the header happens to say.
 *
 * The open balance is shown only when the server published one. Without
 * `sal.finance.view` it is omitted on the wire, and the label then says nothing
 * about money rather than a zero.
 *
 * Offered only with `sal.invoice.manage`, the code the read declares.
 */
export function InvoicePicker({
  messages,
  locale,
  label,
  target,
  status,
  value,
  onChange,
  canSearch,
  error,
  unavailableId,
  pristineId,
  testId = 'invoice-picker',
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly label: string;
  /** The branch the invoices are read in. */
  readonly target: { readonly companyId: string; readonly branchId: string };
  /** Narrow to one state — `issued` on the payment desk. */
  readonly status?: InvoiceStatus | undefined;
  readonly value: InvoiceListEntry | null;
  readonly onChange: (next: InvoiceListEntry | null) => void;
  /** `sal.invoice.manage`. */
  readonly canSearch: boolean;
  readonly error?: string | undefined;
  readonly unavailableId?: string | undefined;
  readonly pristineId?: string | null;
  readonly testId?: string;
}) {
  const { companyId, branchId } = target;
  const load = useCallback(
    (term: string, cursor: string | null) =>
      listInvoices({ companyId, branchId }, { q: term, status }, cursor),
    [companyId, branchId, status]
  );

  /** What a clerk recognises an invoice by: its number, who it bills, its state, what is open. */
  const labelOf = (entry: InvoiceListEntry): string =>
    [
      entry.invoiceNumber ?? translate(messages, 'invoices.picker.unnumbered'),
      entry.payer.displayName ?? translate(messages, 'invoices.picker.payerHidden'),
      translateDynamic(messages, `invoices.status.${entry.status}`),
      entry.outstanding
        ? `${translate(messages, 'invoices.picker.open')} ${entry.outstanding.amount} ${entry.outstanding.currency}`
        : null,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' — ');

  return (
    <SearchPicker<InvoiceListEntry>
      messages={messages}
      locale={locale}
      label={label}
      value={value}
      onChange={onChange}
      labelOf={labelOf}
      load={load}
      canSearch={canSearch}
      notPermitted={translate(messages, 'invoices.picker.notPermitted')}
      unavailableId={unavailableId}
      error={error}
      minLength={MIN_INVOICE_SEARCH}
      maxLength={MAX_INVOICE_SEARCH}
      placeholder={translate(messages, 'invoices.picker.searchPlaceholder')}
      example={translate(messages, 'invoices.picker.searchExample')}
      tooShort={translate(messages, 'invoices.picker.tooShort')}
      resultsLabel={translate(messages, 'invoices.picker.results')}
      change={translate(messages, 'invoices.picker.change')}
      pristineId={pristineId ?? null}
      testId={testId}
    />
  );
}
