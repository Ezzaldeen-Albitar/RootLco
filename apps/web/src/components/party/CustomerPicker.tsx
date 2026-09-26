'use client';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SearchPicker } from '@/components/search/SearchPicker';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { searchCustomerDirectoryCancellable } from '@/lib/customers/directory-read';
import { MAX_NAME_LENGTH, MIN_FREE_TEXT_LENGTH } from '@/lib/customers/directory-contract';

/**
 * A customer, as a payer or a deciding party is chosen: by name, number or phone
 * through `crm.customer-search`'s one free-text box (Owner directive,
 * `P1-32-PRE-OD-UX`).
 *
 * `CustomerSelector` stays what the vehicle and reception screens render; its
 * four boxes and its hidden input belong to action forms. The finance screens
 * hold their state in memory and need the shape `SearchPicker` gives every
 * record chooser — one box, the field's own error, a branch switch that asks
 * first — so this wraps the same directory adapter in that shape rather than
 * adding a second search.
 *
 * Offered only with `crm.customer.read`: without it the read is refused every
 * time, so no box is shown and the sentence says why.
 */
export interface ChosenCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
}

export function customerLabel(customer: ChosenCustomer): string {
  return customer.displayNumber
    ? `${customer.displayName} — ${customer.displayNumber}`
    : customer.displayName;
}

async function loadCustomers(
  term: string,
  cursor: string | null,
  signal: AbortSignal
): Promise<ReadState<CursorPage<ChosenCustomer>>> {
  // Cancellable (P1-32-PRE-OD-READ): the read for a term already typed past is
  // aborted, not only discarded.
  const page = await searchCustomerDirectoryCancellable(
    { ...INITIAL_REQUEST, pageSize: 10 },
    cursor,
    { q: term },
    signal
  );
  if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
  return {
    status: 'ok',
    data: {
      items: page.rows.map((hit) => ({
        id: hit.id,
        displayName: hit.displayName,
        displayNumber: hit.displayNumber,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    },
    correlationId: page.correlationId,
  };
}

export function CustomerPicker({
  messages,
  locale,
  label,
  value,
  onChange,
  canSearch,
  error,
  unavailableId,
  pristineId,
  countsAsUnsaved = true,
  describedBy,
  testId = 'customer-picker',
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly label: string;
  readonly value: ChosenCustomer | null;
  readonly onChange: (next: ChosenCustomer | null) => void;
  /** `crm.customer.read`. */
  readonly canSearch: boolean;
  readonly error?: string | undefined;
  readonly unavailableId?: string | undefined;
  readonly pristineId?: string | null;
  /** False for a list filter — see `SearchPicker`. */
  readonly countsAsUnsaved?: boolean;
  /** Further ids describing the choice — see `SearchPicker`. */
  readonly describedBy?: string | undefined;
  readonly testId?: string;
}) {
  return (
    <SearchPicker<ChosenCustomer>
      messages={messages}
      locale={locale}
      label={label}
      value={value}
      onChange={onChange}
      labelOf={customerLabel}
      load={loadCustomers}
      canSearch={canSearch}
      notPermitted={translate(messages, 'customerPicker.notPermitted')}
      unavailableId={unavailableId}
      error={error}
      minLength={MIN_FREE_TEXT_LENGTH}
      maxLength={MAX_NAME_LENGTH}
      placeholder={translate(messages, 'customerPicker.searchPlaceholder')}
      example={translate(messages, 'customerPicker.searchExample')}
      tooShort={translate(messages, 'customerPicker.tooShort')}
      resultsLabel={translate(messages, 'customerPicker.results')}
      change={translate(messages, 'customerSelector.change')}
      pristineId={pristineId ?? null}
      countsAsUnsaved={countsAsUnsaved}
      describedBy={describedBy}
      testId={testId}
    />
  );
}
