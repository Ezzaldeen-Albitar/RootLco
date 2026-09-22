'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { EmptyState } from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { searchCustomers } from '../api';
import { CustomerCreateActions } from './CustomerCreateActions';
import {
  LIFECYCLE_STATUSES,
  MAX_CUSTOMER_NUMBER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PHONE_LENGTH,
  PARTY_TYPES,
  isEmptyCriteria,
  isFreeTextTooShort,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
} from '../contract';

/**
 * CRM customer search and its results (`P1-27-FE-001`, `P1-27-FE-002`, P1-32).
 *
 * ## One box first, the precise filters one step away (P1-32)
 *
 * A receptionist rarely knows which field the thing they were told belongs to.
 * The prominent box sends `q`, which the backend tries as part of a name, a
 * customer number and a phone number at once. "More filters" opens the precise
 * fields — name, customer number, phone, type and status — for the operator who
 * does know.
 *
 * Digits typed on an Arabic keyboard are echoed as Western digits under a box
 * for reading only. What is sent is what was typed; the backend folds them.
 *
 * ## It searches on intent, never on a bare keystroke
 *
 * `crm.customer-search` is `expensive-read`: **30 requests per 60 seconds**,
 * keyed by operation, workspace and user. A request per CHARACTER spends that
 * in under three seconds of typing, and the operator's reward for typing a
 * customer's name is a refusal.
 *
 * So the primary action is an explicit Search button and Enter submits the form.
 *
 * ## The sentence that used to close this paragraph was wrong, and is corrected
 *
 * It read: "There is no debounce, because a debounce is still a request per
 * pause." The first half is true and the conclusion does not follow. The
 * comparison that decides it is not "debounced typing versus nothing" but
 * "debounced typing versus what the operator actually does" — type, press
 * Search, read, correct the spelling, press Search again — which is one request
 * per attempt, uncancelled, with no upper bound. A 300 ms debounce that ABORTS
 * the request before it sends one per pause and abandons the rest, which is
 * fewer requests against the same limit, not more.
 *
 * The mechanism now exists (`lib/use-debounced-value.ts`,
 * `lib/api/use-search-request.ts`, `components/search/SearchBox.tsx`) and is
 * what a new search surface should be built on. This screen keeps its explicit
 * Search for a reason that survives the correction: the results are a SEPARATELY
 * MOUNTED component, which is what makes "no request before intent" structural
 * here rather than a rule somebody has to remember.
 *
 * **The results are a separate component, mounted only after a submission.**
 * `useServerTable` reads on mount, so not mounting the hook makes "no request
 * before intent" structural instead of guarded.
 *
 * ## Nothing reaches the address bar
 *
 * `P1-27-SEC-002`: the criteria live in screen state. A customer's name or phone
 * number in a URL would be in history, in a referrer and in proxy logs.
 *
 * ## What it does not offer
 *
 * **No sort control.** The operation publishes no `sort` parameter and its route
 * schema is `.strict()`, so a sortable column header would send a 422.
 *
 * **No email box.** Email is not in the allow-list. Phone is, since P1-32, and
 * the phone shown in a row is masked unless the operator may see it whole.
 *
 * **No total.** `hasMore` is the only end-of-set signal the backend publishes.
 *
 * **No "start a visit for this customer" link.** The walk-in desk takes no
 * customer from its address and the check-in hand-off needs a customer AND a
 * vehicle, so there is no existing route such a link could honestly open.
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
  const [tooShort, setTooShort] = useState(false);

  const submit = useCallback(() => {
    // An empty form is not a search. Committing it would mount the results and
    // ask the backend for "everything".
    if (isEmptyCriteria(draft)) return;
    // One character in the free-text box is refused by the backend. Saying so
    // here is better than a validation failure the operator cannot read.
    if (isFreeTextTooShort(draft)) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setCommitted(draft);
  }, [draft]);

  const clear = useCallback(() => {
    setDraft(EMPTY_CRITERIA);
    setCommitted(null);
    setTooShort(false);
  }, []);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <SearchForm
        formId={formId}
        messages={messages}
        draft={draft}
        tooShort={tooShort}
        onChange={setDraft}
        onSubmit={submit}
        onClear={clear}
      />
      {committed === null ? (
        // Not an empty result — nothing has been asked, so nothing is missing.
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
 * still holding the previous set's cursors.
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
        // Not sortable: the operation has no sort parameter.
        cell: (row) => <bdi className="font-medium text-text-primary">{row.displayName}</bdi>,
      },
      {
        id: 'displayNumber',
        headerKey: 'crm.customers.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption text-text-secondary" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            // An em dash, not the id. A customer without a display number has
            // not been numbered yet.
            <span className="text-text-muted">—</span>
          ),
      },
      {
        id: 'partyType',
        headerKey: 'crm.customers.column.type',
        cell: (row) => translate(messages, `crm.partyType.${row.partyType}`),
      },
      {
        id: 'primaryPhone',
        headerKey: 'crm.customers.column.phone',
        cell: (row) =>
          row.primaryPhone ? (
            <span className="flex flex-col">
              {/* Exactly as the backend returned it. The mask is the backend's
                  decision; this screen never reconstructs a hidden digit. */}
              <span className="font-mono text-caption" dir="ltr">
                {row.primaryPhone}
              </span>
              {row.phoneMasked ? (
                <span className="text-caption text-text-muted">
                  {translate(messages, 'crm.customers.search.phonePartlyHidden')}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        id: 'vehicleCount',
        headerKey: 'crm.customers.column.vehicles',
        cell: (row) => <bdi>{row.vehicleCount}</bdi>,
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
        /*
         * `P1-27-FE-002`. The criteria live OUTSIDE `TableRequest`, so the
         * table's own empty state would make a claim about the tenant's whole
         * customer list. The screen owns the zero-result state below.
         */
        suppressEmptyState
        rowActions={(row) => (
          // A real link, so the profile can be opened in a new tab. The route
          // key is the id, never the display number.
          <Link
            href={`/${locale}/crm/customers/${row.id}`}
            className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
          >
            {translate(messages, 'crm.customers.search.open')}
          </Link>
        )}
      />
      {/*
        Repeated here, under a search that found nothing, because that is where
        the thought "this customer is new" actually happens. Only to someone who
        could actually create — `CustomerCreateActions` owns that rule.
      */}
      {noResults ? (
        <div className="flex flex-col items-center gap-3 pb-4 text-center">
          <p className="text-body text-text-secondary">
            {translate(messages, 'crm.customers.search.noMatch')}
          </p>
          <CustomerCreateActions
            locale={locale}
            messages={messages}
            canCreate={canCreate}
            variant="contextual"
          />
        </div>
      ) : null}
    </>
  );
}

function SearchForm({
  formId,
  messages,
  draft,
  tooShort,
  onChange,
  onSubmit,
  onClear,
}: {
  readonly formId: string;
  readonly messages: Messages;
  readonly draft: CustomerSearchCriteria;
  readonly tooShort: boolean;
  readonly onChange: (next: CustomerSearchCriteria) => void;
  readonly onSubmit: () => void;
  readonly onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const qId = `${formId}-q`;
  const filtersId = `${formId}-filters`;
  const nameId = `${formId}-name`;
  const numberId = `${formId}-number`;
  const phoneId = `${formId}-phone`;
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

      <div className="flex flex-col gap-1">
        <label className="text-body font-medium text-text-primary" htmlFor={qId}>
          {translate(messages, 'crm.customers.search.q')}
        </label>
        <input
          id={qId}
          type="search"
          value={draft.q ?? ''}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => onChange({ ...draft, q: event.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-body"
          aria-describedby={tooShort ? `${qId}-hint ${qId}-error` : `${qId}-hint`}
          aria-invalid={tooShort || undefined}
        />
        <span id={`${qId}-hint`} className="text-caption text-text-muted">
          {translate(messages, 'crm.customers.search.qHint')}
        </span>
        <DigitsEcho messages={messages} value={draft.q} />
        {tooShort ? (
          <span id={`${qId}-error`} role="alert" className="text-caption text-error">
            {translate(messages, 'crm.customers.search.qTooShort')}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={filtersId}
          onClick={() => setExpanded((open) => !open)}
          className="text-body text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
        >
          {translate(
            messages,
            expanded ? 'crm.customers.search.fewerFilters' : 'crm.customers.search.moreFilters'
          )}
        </button>
      </div>

      {expanded ? (
        <div id={filtersId} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/*
            The hint is a SIBLING of the label, not a child of it. Inside the
            label its text joins the accessible name.
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
              dir="ltr"
              value={draft.customerNumber ?? ''}
              maxLength={MAX_CUSTOMER_NUMBER_LENGTH}
              onChange={(event) => onChange({ ...draft, customerNumber: event.target.value })}
              className="rounded-md border border-border bg-surface px-3 py-2 text-body"
              aria-describedby={`${numberId}-hint`}
            />
            <span id={`${numberId}-hint`} className="text-caption text-text-muted">
              {translate(messages, 'crm.customers.search.referenceHint')}
            </span>
            <DigitsEcho messages={messages} value={draft.customerNumber} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-caption font-medium text-text-secondary" htmlFor={phoneId}>
              {translate(messages, 'crm.customers.search.phone')}
            </label>
            <input
              id={phoneId}
              type="search"
              inputMode="tel"
              dir="ltr"
              value={draft.phone ?? ''}
              maxLength={MAX_PHONE_LENGTH}
              onChange={(event) => onChange({ ...draft, phone: event.target.value })}
              className="rounded-md border border-border bg-surface px-3 py-2 text-body"
              aria-describedby={`${phoneId}-hint`}
            />
            <span id={`${phoneId}-hint`} className="text-caption text-text-muted">
              {translate(messages, 'crm.customers.search.phoneHint')}
            </span>
            <DigitsEcho messages={messages} value={draft.phone} />
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
                  partyType: (event.target.value ||
                    undefined) as CustomerSearchCriteria['partyType'],
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
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary"
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
