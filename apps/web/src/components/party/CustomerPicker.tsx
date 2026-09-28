'use client';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { EntityPicker } from '@/components/pickers/EntityPicker';
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
 *
 * `material` draws the same chooser on Material UI (`EntityPicker`, one
 * combobox and a listbox) instead of `SearchPicker`'s box and match buttons —
 * the same props, the same read, the same rules. Off unless stated, so a screen
 * and its suite move one at a time (ADR-022). On Material each match also shows
 * its primary phone as the backend returned it, with the "partly hidden" hint
 * when it is masked (`phoneDetail`), as `CustomerSelector` does.
 */
export interface ChosenCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
  /**
   * `individual` or `company`, as the directory answered it — so a screen that
   * labels the chosen customer by kind (`PartyLabel`) does not have to read the
   * customer again. Optional: a choice a screen builds itself (a pre-selection,
   * a duplicate-name row) may not know it, and then the kind is simply not said.
   */
  readonly partyType?: string | null;
  /**
   * The primary phone exactly as the directory answered it — masked to its last
   * digits unless the caller holds `iam.sensitive.view` — and whether it is.
   * The Material chooser draws it under each match (the `G-CRM-PHONE` closure),
   * so a receptionist tells two customers of the same name apart by the caller's
   * number. Optional for the same reason as `partyType`.
   */
  readonly primaryPhone?: string | null;
  readonly phoneMasked?: boolean;
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
        partyType: hit.partyType ?? null,
        primaryPhone: hit.primaryPhone ?? null,
        phoneMasked: hit.phoneMasked === true,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    },
    correlationId: page.correlationId,
  };
}

/**
 * The second line of a match: its phone exactly as returned (left to right,
 * whatever the page direction), and the plain-language hint when it is partly
 * hidden. None when the customer has no phone on record.
 */
function phoneDetail(messages: Messages) {
  return function detail(customer: ChosenCustomer) {
    if (!customer.primaryPhone) return null;
    return (
      <>
        <span className="font-mono" dir="ltr">
          {customer.primaryPhone}
        </span>
        {customer.phoneMasked ? (
          <span className="text-text-muted">
            {translate(messages, 'crm.customers.search.phonePartlyHidden')}
          </span>
        ) : null}
      </>
    );
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
  material = false,
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
  /** Draw it on Material UI (`EntityPicker`). See the docblock. */
  readonly material?: boolean;
}) {
  const shared = {
    messages,
    locale,
    label,
    value,
    onChange,
    labelOf: customerLabel,
    load: loadCustomers,
    canSearch,
    notPermitted: translate(messages, 'customerPicker.notPermitted'),
    unavailableId,
    error,
    minLength: MIN_FREE_TEXT_LENGTH,
    maxLength: MAX_NAME_LENGTH,
    placeholder: translate(messages, 'customerPicker.searchPlaceholder'),
    example: translate(messages, 'customerPicker.searchExample'),
    tooShort: translate(messages, 'customerPicker.tooShort'),
    resultsLabel: translate(messages, 'customerPicker.results'),
    change: translate(messages, 'customerSelector.change'),
    pristineId: pristineId ?? null,
    countsAsUnsaved,
    describedBy,
    testId,
  };
  return material ? (
    <EntityPicker<ChosenCustomer> {...shared} detailOf={phoneDetail(messages)} />
  ) : (
    <SearchPicker<ChosenCustomer> {...shared} />
  );
}
