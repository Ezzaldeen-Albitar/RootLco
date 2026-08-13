'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { INITIAL_REQUEST, withPage, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { TextField, SelectField } from '@/components/forms/Field';
import { PartyLabel } from '@/components/party/PartyLabel';
import {
  BackendUnavailableState,
  ErrorState,
  LoadingState,
  NoResultsState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { searchCustomerDirectory } from '@/lib/customers/directory';
import {
  MAX_CUSTOMER_NUMBER_LENGTH,
  MAX_NAME_LENGTH,
  PARTY_TYPES,
  isEmptyCriteria,
  normalizeCriteria,
  toPartyIdentity,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
  type PartyType,
} from '@/lib/customers/directory-contract';

/**
 * Choosing a customer by name (`P1-27-FE-021`, `P1-27-FE-025`).
 *
 * Ownership transfer and relationship linking both need an operator to name the
 * customer a vehicle is being attached to. The contract wants a `partnerId`, and
 * the obvious implementation — a text box labelled "Customer ID" — is not an
 * implementation of the requirement at all. Nobody in a workshop knows a uuid.
 *
 * So the uuid stays internal: it is carried in a hidden input, submitted with
 * the form, and never rendered. What an operator sees and chooses is a name.
 *
 * ## Why this is in `components/` and owns no search of its own
 *
 * Both callers live in `features/vehicles`, and no feature may import another
 * feature. The search itself is CRM's, so the adapter moved to
 * `@/lib/customers/directory` — one authority, reached from a neutral component,
 * rather than a second search invented here. Same move, same reason, as
 * `RecordForm` and `lib/api/read-operation.ts`.
 *
 * ## It searches on intent, never on a keystroke
 *
 * `GET /api/v1/customers` is `expensive-read`: 30 requests per 60 seconds, keyed
 * by operation, tenant and user. A search-as-you-type selector spends that
 * budget in under three seconds of typing and then rate-limits the operator out
 * of the form they are trying to submit. Typing changes a draft; only Search
 * submits it.
 *
 * ## It is not a `<form>`
 *
 * This component is rendered INSIDE the caller's form. A nested `<form>` is
 * invalid HTML and browsers drop the inner one, so the search controls are a
 * plain region: the button is `type="button"` and Enter in a search box is
 * intercepted and turned into a search rather than a submit of the outer form.
 * Without that, pressing Enter after typing a name would submit an ownership
 * transfer with no customer chosen.
 *
 * ## Nothing reaches the URL
 *
 * The selector holds its criteria in memory. A customer's name in a query string
 * is in browser history, in the `Referer` of every outbound request, and in each
 * proxy log between here and the operator — which is why `table-state.ts` names
 * `name` and `customer` among the keys that may never be serialised.
 *
 * ## No total, no sort
 *
 * The operation publishes `{ items, nextCursor, hasMore }` and accepts no `sort`.
 * The list offers Previous/Next and no range, and no column ordering.
 */

/** What the caller gets back: an id to submit and a label already resolved. */
export interface SelectedCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
  readonly partyType: string;
}

/** The page a selector holds before anybody has searched. Never rendered. */
const UNASKED: ServerPage<CustomerSearchHit> = {
  status: 'ok',
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: null,
};

export function toSelectedCustomer(hit: CustomerSearchHit): SelectedCustomer {
  return {
    id: hit.id,
    displayName: hit.displayName,
    displayNumber: hit.displayNumber,
    partyType: hit.partyType,
  };
}

/** A page of matches, or the reason there is none. */
function Results({
  messages,
  status,
  rows,
  correlationId,
  onRetry,
  onChoose,
}: {
  readonly messages: Messages;
  readonly status: ReturnType<typeof useServerTable<CustomerSearchHit>>['status'];
  readonly rows: readonly CustomerSearchHit[] | null;
  readonly correlationId: string | undefined;
  readonly onRetry: () => void;
  readonly onChoose: (hit: CustomerSearchHit) => void;
}) {
  const retry = (
    <button
      type="button"
      onClick={onRetry}
      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {translate(messages, 'state.retry')}
    </button>
  );

  if (status === 'loading') return <LoadingState messages={messages} />;
  if (status === 'denied') {
    return (
      <PermissionDeniedState messages={messages} {...(correlationId ? { correlationId } : {})} />
    );
  }
  if (status === 'expired') {
    // No Retry. Re-issuing the same request with the same dead session fails
    // identically, and offering the button suggests otherwise.
    return <SessionExpiredState messages={messages} />;
  }
  if (status === 'unavailable') {
    return (
      <BackendUnavailableState
        messages={messages}
        action={retry}
        {...(correlationId ? { correlationId } : {})}
      />
    );
  }
  if (status === 'error' || status === 'not-found') {
    return (
      <ErrorState
        messages={messages}
        action={retry}
        {...(correlationId ? { correlationId } : {})}
      />
    );
  }
  if (rows === null) return null;
  if (rows.length === 0) return <NoResultsState messages={messages} />;

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map((hit) => (
        <li key={hit.id}>
          <button
            // `type="button"`: a bare button inside the caller's form submits it,
            // and choosing a customer must not submit an ownership transfer.
            type="button"
            onClick={() => onChoose(hit)}
            className="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {/* The same label component the relationship and ownership tables
                use, so one customer reads identically wherever they appear.
                `partnerName` is non-null here by construction — a search hit is
                a customer this caller can see. */}
            <PartyLabel messages={messages} party={toPartyIdentity(hit)} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CustomerSelector({
  locale,
  messages,
  name,
  labelKey,
  value,
  onChange,
  required = false,
  attempt = 0,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The form field the chosen customer's id is submitted under. */
  readonly name: string;
  readonly labelKey: string;
  readonly value: SelectedCustomer | null;
  readonly onChange: (customer: SelectedCustomer | null) => void;
  readonly required?: boolean;
  /**
   * The enclosing action's submit counter. **Required in practice whenever this
   * is rendered inside a `<form action={…}>`**, which is every P1-27 use of it.
   *
   * React calls `form.reset()` after a form action, and a `<select>` is never
   * re-synced by the reconciler after mount. Without a value that changes per
   * attempt, the party-type filter reverted to "Any type" after a failed write
   * while `draft.partyType` kept the old value — so the next search was still
   * restricted to companies while the control said it was not. A filter that
   * misreports what it is filtering by is worse than one that resets.
   *
   * Defaulted to 0 rather than made required so a non-form caller need not
   * invent one; `apps/web/tests/form-reset-class.test.ts` requires every use
   * inside a form to pass it.
   */
  readonly attempt?: number;
}) {
  const base = useId();
  const [draft, setDraft] = useState<CustomerSearchCriteria>({});
  /**
   * The criteria actually sent. Separate from `draft` on purpose: this is what
   * makes typing free and searching deliberate. `null` means "the operator has
   * not searched yet", which is a different state from "searched and found
   * nothing".
   */
  const [submitted, setSubmitted] = useState<CustomerSearchCriteria | null>(null);

  const loadKey = JSON.stringify(submitted ?? {});
  const load = useCallback(
    (request: TableRequest, cursor: string | null): Promise<ServerPage<CustomerSearchHit>> =>
      submitted === null
        ? // Not merely "an empty search". `searchCustomerDirectory` is a Server
          // Action, so CALLING it is a network round-trip to the server even
          // though it returns early for empty criteria — and `useServerTable`
          // runs its effect on mount. Resolving locally means a form that
          // renders a selector costs nothing until somebody searches. A test
          // caught this: it counted one call before a single key was pressed.
          Promise.resolve(UNASKED)
        : searchCustomerDirectory(request, cursor, submitted),
    [submitted]
  );
  const table = useServerTable<CustomerSearchHit>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 10 },
    loadKey,
  });

  const partyOptions = useMemo(
    () => PARTY_TYPES.map((v) => ({ value: v, label: translate(messages, `crm.partyType.${v}`) })),
    [messages]
  );

  const search = () => {
    const normalized = normalizeCriteria(draft);
    // An empty search would ask the backend for "everything", spending one of
    // thirty requests to say something the operator did not ask.
    if (isEmptyCriteria(normalized)) return;
    setSubmitted(normalized);
  };

  const choose = (hit: CustomerSearchHit) => {
    onChange(toSelectedCustomer(hit));
    // Collapse the list. Leaving it open invites a second click that silently
    // replaces the choice the operator just made.
    setSubmitted(null);
  };

  const clear = () => {
    onChange(null);
    setSubmitted(null);
  };

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="customer-selector">
        <span className="text-label font-medium text-text-primary">
          {translateDynamic(messages, labelKey)}
        </span>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2">
          <PartyLabel
            messages={messages}
            party={{
              partnerName: value.displayName,
              partnerNumber: value.displayNumber,
              partnerType: value.partyType,
            }}
          />
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'customerSelector.change')}
          </button>
        </div>
        {/* The uuid, submitted and never shown. This is the whole reason the
            component exists: the contract needs an identifier, and an operator
            must never be asked to know one. */}
        <input type="hidden" name={name} value={value.id} data-testid="customer-selector-value" />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="customer-selector"
      role="group"
      aria-labelledby={`${base}-legend`}
    >
      <span id={`${base}-legend`} className="text-label font-medium text-text-primary">
        {translateDynamic(messages, labelKey)}
        {required ? (
          <span aria-hidden="true" className="ms-1 text-error">
            *
          </span>
        ) : null}
      </span>

      <p className="text-supporting text-text-muted" lang={locale}>
        {translate(messages, 'customerSelector.hint')}
      </p>

      {/*
        Three columns WHEN THREE COLUMNS FIT, decided by this box and not by the
        window.

        It was `sm:grid-cols-3`, and `sm:` is a viewport query. This component is
        mounted in containers of very different widths — full width on the
        walk-in intake, and half of a two-column panel inside the check-in
        wizard — so the viewport says nothing useful about how much room these
        three fields actually have. At 1024x768 the wizard's panel gives this
        group 311px, the viewport is comfortably past the `sm` breakpoint, and
        the media query therefore laid three fields out in 95.5px tracks: a name
        box under ten characters wide, and a type picker whose only option was
        rendered as "Any typ⌄".

        `auto-fit` + `minmax` asks the same question of the CONTAINER: as many
        11rem tracks as fit, sharing the remainder. Wide enough for three and it
        is the old layout exactly — 1104px desktop and the 688px full-width
        tablet column both still give three. Too narrow and the fields stack at
        full width instead of shrinking below legibility, which is what should
        have happened in the wizard all along.
      */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
        <TextField
          label={translate(messages, 'crm.customers.column.name')}
          value={draft.name ?? ''}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          onKeyDown={(event) => {
            // Enter must search, not submit the caller's form. Without this the
            // outer ownership-transfer form submits with no customer chosen.
            if (event.key === 'Enter') {
              event.preventDefault();
              search();
            }
          }}
        />
        <TextField
          label={translate(messages, 'crm.customers.column.reference')}
          value={draft.customerNumber ?? ''}
          maxLength={MAX_CUSTOMER_NUMBER_LENGTH}
          dir="ltr"
          onChange={(event) => setDraft({ ...draft, customerNumber: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              search();
            }
          }}
        />
        {/*
         * Uncontrolled + remounted per attempt + onChange — the same three-part
         * shape `RecordForm` uses, for the same reason. A controlled `value=`
         * here loses to the post-action `form.reset()`.
         */}
        <SelectField
          key={`party-type-${attempt}`}
          label={translate(messages, 'crm.customers.column.type')}
          defaultValue={draft.partyType ?? ''}
          options={partyOptions}
          placeholder={translate(messages, 'customerSelector.anyType')}
          onChange={(event) =>
            setDraft({
              ...draft,
              partyType: (event.target.value || undefined) as PartyType | undefined,
            })
          }
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={search}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'customerSelector.search')}
        </button>
        {/* Deliberately no phone or email box. `NFR-PRV-001` makes raw contact
            values non-searchable, so a control for one could not work — and
            offering it disabled would advertise a capability the product does
            not have. */}
      </div>

      {submitted === null ? (
        <p className="text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'customerSelector.idle')}
        </p>
      ) : (
        <div aria-live="polite" className="flex flex-col gap-3">
          <Results
            messages={messages}
            status={table.status}
            rows={table.response?.rows ?? null}
            correlationId={table.correlationId}
            onRetry={table.refresh}
            onChoose={choose}
          />

          {table.response && (table.response.hasMore || table.request.page > 1) ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={table.request.page <= 1}
                onClick={() => table.setRequest(withPage(table.request, table.request.page - 1))}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'table.previousPage')}
              </button>
              <button
                type="button"
                disabled={!table.response.hasMore}
                onClick={() => table.setRequest(withPage(table.request, table.request.page + 1))}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'table.nextPage')}
              </button>
              {/* No "showing 1–10 of 240". The operation publishes no count, and
                  the last page of a cursor-paginated set is not knowable
                  without walking it. */}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
