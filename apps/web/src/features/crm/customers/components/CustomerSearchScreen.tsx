'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { useSearchRequest } from '@/lib/api/use-search-request';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { searchCustomerDirectoryCancellable } from '@/lib/customers/directory-read';
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
 * CRM customer search and its results (`P1-27-FE-001`, `P1-27-FE-002`, P1-32),
 * on Material UI since `P1-32-PRE-OD-CRM1B`.
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
 * `lib/api/use-search-request.ts`) and is what a new search surface should be
 * built on. This screen keeps its explicit Search for a reason that survives the
 * correction: the results are a SEPARATELY MOUNTED component, which is what
 * makes "no request before intent" structural here rather than a rule somebody
 * has to remember.
 *
 * **The results are a separate component, mounted only after a submission.**
 * The search reads when it is mounted, so not mounting it makes "no request
 * before intent" structural instead of guarded.
 *
 * ## On Material UI (`P1-32-PRE-OD-CRM1B`)
 *
 * Presentation only. The results are `OperationalGrid` over the search's own
 * `table`, the boxes and the two selects are the shared Material form fields,
 * and the idle sentence is `MuiEmptyState`. What is read, when, and with which
 * criteria is exactly as before: the loader, the submission rule and the key
 * the results are mounted under did not change.
 *
 * The shared search box is no longer used here. What it gave this box is kept
 * on the Material field: `type="search"`, `dir="auto"`, no spell check, no
 * autocomplete, a text keypad, Escape to empty the box, and the clear (×)
 * control at the box's logical end, named by the shared `search.clear` words.
 * Enter is the form's own submission.
 *
 * ## Nothing reaches the address bar
 *
 * `P1-27-SEC-002`: the criteria live in screen state. A customer's name or phone
 * number in a URL would be in history, in a referrer and in proxy logs.
 *
 * ## What it does not offer
 *
 * **No sort control.** The operation publishes no `sort` parameter and its route
 * schema is `.strict()`, so a sortable column header would send a 422. The search's
 * table says it honours no sort, so the grid draws no such header.
 *
 * **No email box.** Email is not in the allow-list. Phone is, since P1-32, and
 * the phone shown in a row is masked unless the operator may see it whole.
 *
 * **No total, and no page-size choice.** `hasMore` is the only end-of-set
 * signal the backend publishes, and the search takes a cursor and nothing else.
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
        <MuiEmptyState
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
 * Keyed on the criteria, so a new search remounts rather than reusing a grid
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
  const { version: workingContextVersion } = useWorkingContext();

  const load = useCallback(
    async (
      asked: CustomerSearchCriteria,
      cursor: string | null,
      signal: AbortSignal
    ): Promise<ReadState<CursorPage<CustomerSearchHit>>> => {
      // Cancellable (P1-32-PRE-OD-READ): the same read `searchCustomers`
      // performs, through the route, so a superseded search is aborted.
      const page = await searchCustomerDirectoryCancellable(INITIAL_REQUEST, cursor, asked, signal);
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  /*
   * The search, not a table read (P1-32).
   *
   * `useServerTable` reads whenever its key moves and has no notion of a term
   * settling, a submission, or an answer being superseded. `useSearchRequest`
   * owns those three and hands back the same page contract, so the grid and
   * its pager below walk it unchanged — Previous and Next still walk the cursor
   * stack, and a criteria or branch change still restarts at page one.
   */
  const search = useSearchRequest<CustomerSearchHit, CustomerSearchCriteria>({
    criteria,
    load,
    version: workingContextVersion,
  });

  // No column offers a sort: the operation has no sort parameter.
  const columns = useMemo<readonly OperationalColumn<CustomerSearchHit>[]>(
    () => [
      {
        id: 'displayName',
        headerKey: 'crm.customers.column.name',
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

  /*
   * "No matches" is the PHASE, not a row count.
   *
   * `table.status === 'idle' && rows.length === 0` was true of an answered read
   * with no rows — and also, for one render, of a table that had not been asked
   * anything yet. `empty` is reachable only from a COMPLETED read that returned
   * nothing, so the sentence cannot appear before there is an answer to base it
   * on.
   */
  const noResults = search.phase === 'empty';

  return (
    <>
      <OperationalGrid<CustomerSearchHit>
        messages={messages}
        locale={locale}
        label={translate(messages, 'crm.customers.search.tableCaption')}
        columns={columns}
        rowId={(row) => row.id}
        table={search.table}
        /*
         * `P1-27-FE-002`. The criteria live OUTSIDE `TableRequest`, so the
         * grid's own empty state would make a claim about the tenant's whole
         * customer list. The screen owns the zero-result state below.
         */
        suppressEmptyState
        // A real link, so the profile can be opened in a new tab. The route key
        // is the id, never the display number; the name is announced with it.
        rowActions={(row) => [
          {
            kind: 'link',
            label: translate(messages, 'crm.customers.search.open'),
            href: `/${locale}/crm/customers/${row.id}`,
            about: row.displayName,
          },
        ]}
        testId="customer-search-grid"
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
  const filtersId = `${formId}-filters`;
  const q = draft.q ?? '';

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

      {/*
        The prominent box. The words are this screen's: the label and the
        example say what may be typed HERE, because a generic "Search…" is the
        shape of a control rather than a question. Escape empties the box, and
        the clear control does the same; Enter is the form's submission.
      */}
      <div className="flex flex-col gap-1">
        <FormTextField
          label={translate(messages, 'crm.customers.search.q')}
          description={translate(messages, 'crm.customers.search.qHint')}
          error={tooShort ? translate(messages, 'crm.customers.search.qTooShort') : undefined}
          type="search"
          inputMode="text"
          dir="auto"
          spellCheck={false}
          autoComplete="off"
          value={q}
          maxLength={MAX_NAME_LENGTH}
          onChange={(next) => onChange({ ...draft, q: next })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && q.length > 0) {
              event.preventDefault();
              onChange({ ...draft, q: '' });
            }
          }}
          endAdornment={
            q.length > 0 ? (
              <IconButton
                type="button"
                size="small"
                aria-label={translate(messages, 'search.clear')}
                onClick={() => onChange({ ...draft, q: '' })}
              >
                <span aria-hidden="true">&times;</span>
              </IconButton>
            ) : undefined
          }
          testId="customer-search-box"
        />
        <DigitsEcho messages={messages} value={draft.q} />
      </div>

      <div className="mt-3">
        <Button
          type="button"
          variant="text"
          aria-expanded={expanded}
          aria-controls={filtersId}
          onClick={() => setExpanded((open) => !open)}
        >
          {translate(
            messages,
            expanded ? 'crm.customers.search.fewerFilters' : 'crm.customers.search.moreFilters'
          )}
        </Button>
      </div>

      {expanded ? (
        <div id={filtersId} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Each hint is the field's description, outside its accessible name. */}
          <FormTextField
            label={translate(messages, 'crm.customers.search.name')}
            description={translate(messages, 'crm.customers.search.nameHint')}
            type="search"
            value={draft.name ?? ''}
            maxLength={MAX_NAME_LENGTH}
            onChange={(next) => onChange({ ...draft, name: next })}
          />

          <div className="flex flex-col gap-1">
            <FormTextField
              label={translate(messages, 'crm.customers.search.reference')}
              description={translate(messages, 'crm.customers.search.referenceHint')}
              type="search"
              dir="ltr"
              value={draft.customerNumber ?? ''}
              maxLength={MAX_CUSTOMER_NUMBER_LENGTH}
              onChange={(next) => onChange({ ...draft, customerNumber: next })}
            />
            <DigitsEcho messages={messages} value={draft.customerNumber} />
          </div>

          <div className="flex flex-col gap-1">
            <FormTextField
              label={translate(messages, 'crm.customers.search.phone')}
              description={translate(messages, 'crm.customers.search.phoneHint')}
              type="search"
              inputMode="tel"
              dir="ltr"
              value={draft.phone ?? ''}
              maxLength={MAX_PHONE_LENGTH}
              onChange={(next) => onChange({ ...draft, phone: next })}
            />
            <DigitsEcho messages={messages} value={draft.phone} />
          </div>

          <FormSelectField
            label={translate(messages, 'crm.customers.search.type')}
            value={draft.partyType ?? ''}
            placeholder={translate(messages, 'crm.customers.search.anyType')}
            options={PARTY_TYPES.map((value) => ({
              value,
              label: translate(messages, `crm.partyType.${value}`),
            }))}
            onChange={(next) =>
              onChange({
                ...draft,
                partyType: (next || undefined) as CustomerSearchCriteria['partyType'],
              })
            }
          />

          <FormSelectField
            label={translate(messages, 'crm.customers.search.status')}
            value={draft.lifecycleStatus ?? ''}
            placeholder={translate(messages, 'crm.customers.search.anyStatus')}
            options={LIFECYCLE_STATUSES.map((value) => ({
              value,
              label: translate(messages, `crm.lifecycle.${value}`),
            }))}
            onChange={(next) =>
              onChange({
                ...draft,
                lifecycleStatus: (next || undefined) as CustomerSearchCriteria['lifecycleStatus'],
              })
            }
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="contained">
          {translate(messages, 'crm.customers.search.submit')}
        </Button>
        <Button type="button" variant="outlined" onClick={onClear}>
          {translate(messages, 'crm.customers.search.clear')}
        </Button>
      </div>
    </form>
  );
}
