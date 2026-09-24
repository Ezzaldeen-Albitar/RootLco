'use client';

import { useCallback } from 'react';

import { SearchPicker } from '@/components/search/SearchPicker';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatMoney } from '@/lib/money';

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
 * The number is always searchable. The payer's name is searched, and shown, only
 * for a caller who may read customers, and the plate or VIN only for one who may
 * read vehicles — the server decides both. A withheld name arrives as `null` and
 * the choice says "customer not shown" in its place, never a blank.
 *
 * `sal.invoice-list` requires the company AND the branch, and so does this
 * picker: an allocation cannot cross a branch boundary, so the caller passes the
 * branch the receipt belongs to rather than whatever the header happens to say.
 *
 * The open balance is shown only for an invoice that can owe anything — `issued`
 * or `credited` — and only when the server published one, formatted through
 * `formatMoney` as every invoice screen formats money. A draft's balance is a
 * true zero the server computes before anything is billed, and printing
 * "still open: 0.00" beside it would read as "paid"; the status already says
 * what a draft is. Where the amounts are not visible the balance is omitted on
 * the wire, and the label then says nothing about money rather than a zero.
 *
 * Offered only with `sal.finance.view`, the code the read declares.
 */

/** The states that can owe money; any other state's balance is not shown. */
const OWING_STATES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['issued', 'credited']);

export function InvoicePicker({
  messages,
  locale,
  label,
  target,
  status,
  allocatable = false,
  value,
  onChange,
  canSearch,
  error,
  unavailableId,
  pristineId,
  countsAsUnsaved = true,
  testId = 'invoice-picker',
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly label: string;
  /** The branch the invoices are read in. */
  readonly target: { readonly companyId: string; readonly branchId: string };
  /** Narrow to one state. */
  readonly status?: InvoiceStatus | undefined;
  /**
   * Only the invoices money can still be applied to — `issued` or `credited`
   * with a balance open, as the server decides. The allocation form asks for it.
   */
  readonly allocatable?: boolean;
  readonly value: InvoiceListEntry | null;
  readonly onChange: (next: InvoiceListEntry | null) => void;
  /** `sal.finance.view`. */
  readonly canSearch: boolean;
  readonly error?: string | undefined;
  readonly unavailableId?: string | undefined;
  readonly pristineId?: string | null;
  /** False for a list filter — see `SearchPicker`. */
  readonly countsAsUnsaved?: boolean;
  readonly testId?: string;
}) {
  const { companyId, branchId } = target;
  const load = useCallback(
    (term: string, cursor: string | null) =>
      listInvoices({ companyId, branchId }, { q: term, status, allocatable }, cursor),
    [companyId, branchId, status, allocatable]
  );

  /** What a clerk recognises an invoice by: its number, who it bills, its state, what is open. */
  const labelOf = (entry: InvoiceListEntry): string =>
    [
      entry.invoiceNumber ?? translate(messages, 'invoices.picker.unnumbered'),
      entry.payer.displayName ?? translate(messages, 'invoices.picker.payerHidden'),
      translateDynamic(messages, `invoices.status.${entry.status}`),
      entry.outstanding && OWING_STATES.has(entry.status)
        ? `${translate(messages, 'invoices.picker.open')} ${formatMoney(entry.outstanding, locale)}`
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
      countsAsUnsaved={countsAsUnsaved}
      testId={testId}
    />
  );
}
