'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { EmptyState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { searchCustomers } from '../api';
import {
  LIFECYCLE_STATUSES,
  MAX_CUSTOMER_NUMBER_LENGTH,
  MAX_NAME_LENGTH,
  PARTY_TYPES,
  isEmptyCriteria,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
} from '../contract';

/**
 * CRM customer search and its results (`P1-27-FE-001`, `P1-27-FE-002`).
 *
 * ## It searches on intent, never on a keystroke
 *
 * `crm.customer-search` is `expensive-read`: **30 requests per 60 seconds**,
 * keyed by operation, tenant and user. Search-as-you-type spends that in under
 * three seconds of typing, and the operator's reward for typing a customer's
 * name is a 429.
 *
 * So the primary action is an explicit Search button, Enter submits the form,
 * and typing does nothing at all. There is no debounce, because a debounce is
 * still a request per pause and this screen has no client-side suggestion source
 * to debounce against — inventing one would mean holding customer names in the
 * browser, which is the opposite of what `NFR-PRV-001` is protecting.
 *
 * **The results are a separate component, mounted only after a submission.**
 * That is not organisation; it is the mechanism. `useServerTable` reads on
 * mount, so a version of this screen that held the hook at the top would issue a
 * request before the operator had asked for anything — and would then depend on
 * the adapter refusing empty criteria to stay correct. Not mounting the hook
 * makes "no request before intent" structural instead of guarded.
 *
 * ## What it does not offer
 *
 * **No sort control.** The operation publishes no `sort` parameter and its route
 * schema is `.strict()`, so a sortable column header would send a 422. The order
 * is `(created_at DESC, id DESC)`.
 *
 * **No phone or email box.** They are not in the allow-list, deliberately —
 * see `contract.ts`.
 *
 * **No total.** `hasMore` is the only end-of-set signal the backend publishes.
 */

interface Props {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly canCreate: boolean;
}

const EMPTY_CRITERIA: CustomerSearchCriteria = {};

export function CustomerSearchScreen({ locale, messages, canCreate }: Props) {
  const formId = useId();
  const [draft, setDraft] = useState<CustomerSearchCriteria>(EMPTY_CRITERIA);
  const [committed, setCommitted] = useState<CustomerSearchCriteria | null>(null);

  const submit = useCallback(() => {
    // An empty form is not a search. Committing it would mount the results and
    // ask the backend for "everything", which is neither what was asked nor
    // something a 30-per-minute budget should spend on nothing.
    if (isEmptyCriteria(draft)) return;
    setCommitted(draft);
  }, [draft]);

  const clear = useCallback(() => {
    setDraft(EMPTY_CRITERIA);
    setCommitted(null);
  }, []);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <SearchForm
        formId={formId}
        messages={messages}
        draft={draft}
        onChange={setDraft}
        onSubmit={submit}
        onClear={clear}
      />
      {committed === null ? (
        // Not an empty result — nothing has been asked, so nothing is missing.
        // The screen says how to ask rather than reporting that it found nothing.
        <EmptyState
          messages={messages}
          titleKey="crm.customers.search.idleTitle"
          descriptionKey="crm.customers.search.idleDescription"
        />
      ) : (
        <CustomerSearchResults
          key={JSON.stringify(committed)}
          locale={locale}
          messages={messages}
          criteria={committed}
          canCreate={canCreate}
        />
      )}
    </div>
  );
}

/**
 * The results, mounted only once a search has been submitted.
 *
 * Keyed on the criteria, so a new search remounts rather than reusing a table
 * still holding the previous set's cursors. `useCursorPages` also resets on an
 * ordering change; the key is the coarser guarantee that does not depend on
 * getting the ordering key right.
 */
function CustomerSearchResults({
  locale,
  messages,
  criteria,
  canCreate,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly criteria: CustomerSearchCriteria;
  readonly canCreate: boolean;
}) {
  const router = useRouter();

  const load = useCallback(
    (request: TableRequest, cursor: string | null) => searchCustomers(request, cursor, criteria),
    [criteria]
  );

  const table = useServerTable<CustomerSearchHit>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<CustomerSearchHit>[]>(
    () => [
      {
        id: 'displayName',
        headerKey: 'crm.customers.column.name',
        // Not sortable, and not because it was forgotten: the operation has no
        // sort parameter. See the module note.
        cell: (row) => <span className="font-medium text-text-primary">{row.displayName}</span>,
      },
      {
        id: 'displayNumber',
        headerKey: 'crm.customers.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption text-text-secondary">{row.displayNumber}</code>
          ) : (
            // An em dash, not the id. A customer without a display number has
            // not been numbered yet; showing its uuid would put an internal
            // identifier in front of an operator as though it were a reference.
            <span className="text-text-muted">—</span>
          ),
      },
      {
        id: 'partyType',
        headerKey: 'crm.customers.column.type',
        cell: (row) => translate(messages, `crm.partyType.${row.partyType}`),
      },
      {
        id: 'lifecycleStatus',
        headerKey: 'crm.customers.column.status',
        cell: (row) => translate(messages, `crm.lifecycle.${row.lifecycleStatus}`),
      },
    ],
    [messages]
  );

  const noResults = table.status === 'idle' && table.response?.rows.length === 0;

  return (
    <>
      <DataTable<CustomerSearchHit>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'crm.customers.search.tableCaption')}
        rowActions={(row) => (
          <button
            type="button"
            onClick={() => router.push(`/${locale}/crm/customers/${row.id}`)}
            className="text-link underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {translate(messages, 'crm.customers.search.open')}
          </button>
        )}
      />
      {/*
        Offered only after a search that found nothing, and only to someone who
        could actually create. Showing it to an operator without
        `crm.customer.create` would put a button in front of them whose only
        possible outcome is a 403 — and offering it before a search would invite
        creating a duplicate of a customer they have not looked for yet.
      */}
      {canCreate && noResults ? (
        <div className="flex flex-wrap justify-center gap-2 pb-4">
          <a
            href={`/${locale}/crm/customers/new/individual`}
            className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
          >
            {translate(messages, 'crm.customers.search.createIndividual')}
          </a>
          <a
            href={`/${locale}/crm/customers/new/company`}
            className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
          >
            {translate(messages, 'crm.customers.search.createCompany')}
          </a>
        </div>
      ) : null}
    </>
  );
}

function SearchForm({
  formId,
  messages,
  draft,
  onChange,
  onSubmit,
  onClear,
}: {
  readonly formId: string;
  readonly messages: Messages;
  readonly draft: CustomerSearchCriteria;
  readonly onChange: (next: CustomerSearchCriteria) => void;
  readonly onSubmit: () => void;
  readonly onClear: () => void;
}) {
  const nameId = `${formId}-name`;
  const numberId = `${formId}-number`;
  const typeId = `${formId}-type`;
  const statusId = `${formId}-status`;

  return (
    <form
      // `onSubmit` is what makes Enter work, in every field, without a keydown
      // handler per input. `noValidate` so the browser's own bubble does not
      // replace the form's messages in a language it did not choose.
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
      aria-labelledby={`${formId}-legend`}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id={`${formId}-legend`} className="sr-only">
        {translate(messages, 'crm.customers.search.formLabel')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/*
          The hint is a SIBLING of the label, not a child of it. Inside the
          label its text joins the accessible name, so the field announces
          "Name Matches the start of the name" — which is both wrong and
          unfindable by the name a user would say.
        */}
        <div className="flex flex-col gap-1">
          <label className="text-caption font-medium text-text-secondary" htmlFor={nameId}>
            {translate(messages, 'crm.customers.search.name')}
          </label>
          <input
            id={nameId}
            type="search"
            value={draft.name ?? ''}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-body"
            aria-describedby={`${nameId}-hint`}
          />
          {/* Stated, because prefix and substring are different promises and an
              operator expecting substring concludes the data is missing. */}
          <span id={`${nameId}-hint`} className="text-caption text-text-muted">
            {translate(messages, 'crm.customers.search.nameHint')}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-caption font-medium text-text-secondary" htmlFor={numberId}>
            {translate(messages, 'crm.customers.search.reference')}
          </label>
          <input
            id={numberId}
            type="search"
            value={draft.customerNumber ?? ''}
            maxLength={MAX_CUSTOMER_NUMBER_LENGTH}
            onChange={(event) => onChange({ ...draft, customerNumber: event.target.value })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-body"
            aria-describedby={`${numberId}-hint`}
          />
          <span id={`${numberId}-hint`} className="text-caption text-text-muted">
            {translate(messages, 'crm.customers.search.referenceHint')}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-caption font-medium text-text-secondary" htmlFor={typeId}>
            {translate(messages, 'crm.customers.search.type')}
          </label>
          <select
            id={typeId}
            value={draft.partyType ?? ''}
            onChange={(event) =>
              onChange({
                ...draft,
                partyType: (event.target.value || undefined) as CustomerSearchCriteria['partyType'],
              })
            }
            className="rounded-md border border-border bg-surface px-3 py-2 text-body"
          >
            <option value="">{translate(messages, 'crm.customers.search.anyType')}</option>
            {PARTY_TYPES.map((value) => (
              <option key={value} value={value}>
                {translate(messages, `crm.partyType.${value}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-caption font-medium text-text-secondary" htmlFor={statusId}>
            {translate(messages, 'crm.customers.search.status')}
          </label>
          <select
            id={statusId}
            value={draft.lifecycleStatus ?? ''}
            onChange={(event) =>
              onChange({
                ...draft,
                lifecycleStatus: (event.target.value ||
                  undefined) as CustomerSearchCriteria['lifecycleStatus'],
              })
            }
            className="rounded-md border border-border bg-surface px-3 py-2 text-body"
          >
            <option value="">{translate(messages, 'crm.customers.search.anyStatus')}</option>
            {LIFECYCLE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {translate(messages, `crm.lifecycle.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-brand-primary px-4 py-2 text-body font-medium text-on-brand"
        >
          {translate(messages, 'crm.customers.search.submit')}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-border px-4 py-2 text-body text-text-secondary"
        >
          {translate(messages, 'crm.customers.search.clear')}
        </button>
      </div>
    </form>
  );
}
