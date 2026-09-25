'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { TextField, SelectField } from '@/components/forms/Field';
import { PartyLabel } from '@/components/party/PartyLabel';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest, type SearchPhase } from '@/lib/api/use-search-request';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { Locale } from '@/i18n/config';
import { searchCustomerDirectory } from '@/lib/customers/directory';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import {
  MAX_CUSTOMER_NUMBER_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PHONE_LENGTH,
  PARTY_TYPES,
  isEmptyCriteria,
  isFreeTextTooShort,
  normalizeCriteria,
  toPartyIdentity,
  type CustomerSearchCriteria,
  type CustomerSearchHit,
  type PartyType,
} from '@/lib/customers/directory-contract';

/**
 * Choosing a customer by name, number or phone (`P1-27-FE-021`, `P1-27-FE-025`,
 * P1-32).
 *
 * P1-32 added two boxes: one free-text box (`q`, part of a name, a customer
 * number or a phone number) and a phone box (the whole number or at least its
 * last seven digits). A match shows its primary phone exactly as the backend
 * returned it — partly hidden unless the operator may see it whole.
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
 * ## It searches as the operator types, and that is FEWER requests
 *
 * `GET /api/v1/customers` is `expensive-read`: 30 requests per 60 seconds, keyed
 * by operation, workspace and user. This component used to answer that with an
 * explicit Search button and no debounce, on the reasoning that "a debounce is
 * still a request per pause". True, and it does not follow — the honest
 * comparison is not "debounced typing versus nothing" but "debounced typing
 * versus what an operator actually does", which is: type a few characters,
 * press Search, read, correct the spelling, press Search again. That is one
 * request per attempt, uncancelled and unbounded.
 *
 * `useSearchRequest` sends one per PAUSE and discards every superseded answer,
 * which is fewer requests against the same limit — and it is what stops the
 * receptionist who is reading a phone number aloud from having to find a button
 * between every correction. The rate limit therefore argues FOR the debounce.
 *
 * The Search control stays, and it is not decoration: it SUBMITS NOW, skipping
 * the wait for somebody who has already decided, and it re-issues after a
 * failure — which is what makes it usable as a retry. Enter does the same.
 *
 * ## The failure states are the shared ones, and there is no longer an exception
 *
 * `SearchStates` renders every non-answer phase, so a refusal cannot collapse
 * into "no matches" here any more than it can on a search screen. This control
 * used to carry one special case of its own — an ended session, which the hook
 * reported as `failed` carrying `state.expired.message` and which
 * `SearchStates` rendered as a generic fault with a retry that could not work.
 * The hook publishes `expired` as its own phase now and `SearchStates` renders
 * it as itself, so the special case is gone rather than duplicated.
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
 *
 * ## A refusal about the choice is drawn ON the choice
 *
 * The caller's complaint — nothing chosen yet, for instance — arrives as
 * `error` and lands on the free-text box (`aria-invalid`, a red edge, the
 * sentence beneath it) or, once a customer is chosen, on the control that
 * changes it. It used to be drawn beside the caller's submit button, some
 * 460 px below the selector, with the selector itself unmarked (browser QA
 * part 7, row 6.6); marking the control is also what lets
 * `useFocusFirstInvalid` bring the cursor here.
 *
 * ## Choosing keeps the cursor
 *
 * The pressed match leaves the page when the list collapses, and a focused
 * element that leaves the page drops the cursor to the document body (row
 * 10.4). The cursor moves to the Change control instead, which is described by
 * the chosen customer's name, so what was chosen is announced.
 */

/** What the caller gets back: an id to submit and a label already resolved. */
export interface SelectedCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly displayNumber: string | null;
  readonly partyType: string;
}

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
  locale,
  phase,
  rows,
  correlationId,
  onRetry,
  onChoose,
}: {
  readonly messages: Messages;
  /** Carried through so the ended-session state can offer the way back. */
  readonly locale: Locale;
  readonly phase: SearchPhase;
  readonly rows: readonly CustomerSearchHit[];
  readonly correlationId: string | null;
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

  if (phase !== 'ready') {
    return (
      <SearchStates
        messages={messages}
        locale={locale}
        phase={phase}
        correlationId={correlationId}
        {...(phase === 'unavailable' || phase === 'failed' ? { retry } : {})}
      />
    );
  }

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
            {hit.primaryPhone ? (
              <span className="ms-auto flex shrink-0 flex-col items-end">
                <span className="font-mono text-caption text-text-secondary" dir="ltr">
                  {hit.primaryPhone}
                </span>
                {hit.phoneMasked ? (
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'crm.customers.search.phonePartlyHidden')}
                  </span>
                ) : null}
              </span>
            ) : null}
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
  error,
  describedBy,
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
  /** The caller's refusal about the choice, already translated. */
  readonly error?: string | undefined;
  /** Further ids describing the choice, added to the box or the change control. */
  readonly describedBy?: string | undefined;
}) {
  const base = useId();
  const chosenId = `${base}-chosen`;
  const errorId = `${base}-error`;
  const [draft, setDraft] = useState<CustomerSearchCriteria>({});

  /*
   * The cursor after a choice — see the docblock. A ref flag set by the click
   * that chose, so a value the CALLER supplies (a walk-in handed over with its
   * customer) moves nobody's cursor on arrival.
   */
  const changeRef = useRef<HTMLButtonElement | null>(null);
  const focusChosen = useRef(false);
  useEffect(() => {
    if (!focusChosen.current || value === null) return;
    focusChosen.current = false;
    changeRef.current?.focus();
  }, [value]);

  /*
   * What is asked for, or `null` for "nothing yet".
   *
   * Built inline: `useSearchRequest` keys on the SERIALISED criteria rather than
   * on the object's identity, so a new object with the same content asks for the
   * same thing. `null` covers both reasons there is nothing to ask — an
   * untouched form, and a free-text box holding one character the backend would
   * refuse — and in that state the hook issues no request at all. That is what
   * makes "a form that merely renders a selector costs nothing" a property of
   * the hook rather than a local guard somebody can forget.
   */
  const normalized = normalizeCriteria(draft);
  const tooShort = isFreeTextTooShort(draft);
  const criteria = tooShort || isEmptyCriteria(normalized) ? null : normalized;

  const load = useCallback(
    async (
      asked: CustomerSearchCriteria,
      cursor: string | null
    ): Promise<ReadState<CursorPage<CustomerSearchHit>>> => {
      // The directory answers in `ServerPage`, which is the shape
      // `useServerTable` consumes; the hook reads `ReadState<CursorPage>`. The
      // two carry the same facts under different names, and writing the
      // translation here keeps it at the one place they meet.
      const page = await searchCustomerDirectory(
        { ...INITIAL_REQUEST, pageSize: 10 },
        cursor,
        asked
      );
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest<CustomerSearchHit, CustomerSearchCriteria>({ criteria, load });

  const partyOptions = useMemo(
    () => PARTY_TYPES.map((v) => ({ value: v, label: translate(messages, `crm.partyType.${v}`) })),
    [messages]
  );

  const choose = (hit: CustomerSearchHit) => {
    focusChosen.current = true;
    onChange(toSelectedCustomer(hit));
    // Collapse the list. Leaving it open invites a second click that silently
    // replaces the choice the operator just made. Clearing the draft is what
    // collapses it, because the criteria are what the list exists for.
    setDraft({});
  };

  const clear = () => {
    onChange(null);
    setDraft({});
  };

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="customer-selector">
        <span className="text-label font-medium text-text-primary">
          {translateDynamic(messages, labelKey)}
        </span>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2">
          <span id={chosenId}>
            <PartyLabel
              messages={messages}
              party={{
                partnerName: value.displayName,
                partnerNumber: value.displayNumber,
                partnerType: value.partyType,
              }}
            />
          </span>
          <button
            ref={changeRef}
            type="button"
            onClick={clear}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [chosenId, error ? errorId : undefined, describedBy].filter(Boolean).join(' ') ||
              undefined
            }
            className={`shrink-0 rounded-md border ${error ? 'border-error' : 'border-border'} px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`}
          >
            {translate(messages, 'customerSelector.change')}
          </button>
        </div>
        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-supporting text-error">
            <span
              aria-hidden="true"
              className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-error text-caption font-bold leading-none"
            >
              !
            </span>
            <span id={errorId}>{error}</span>
          </p>
        ) : null}
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
        <div className="flex flex-col gap-1">
          <SearchBox
            messages={messages}
            label={translate(messages, 'customerSelector.q')}
            value={draft.q ?? ''}
            maxLength={MAX_NAME_LENGTH}
            busy={search.phase === 'loading'}
            // The control already carries the page's own Search button below, so
            // it does not add a second one: two controls with the same name on
            // one form are two things for a keyboard user to disambiguate.
            inlineSubmit={false}
            onSubmit={search.submit}
            onChange={(next) => setDraft({ ...draft, q: next })}
            describedBy={describedBy}
            // The length refusal is about what was typed and wins while it
            // stands; the caller's refusal is about the choice, and the box is
            // where the choice is made — so it is the control marked for it.
            {...(tooShort
              ? { error: translate(messages, 'crm.customers.search.qTooShort') }
              : error
                ? { error }
                : {})}
          />
          <DigitsEcho messages={messages} value={draft.q} />
        </div>
        <div className="flex flex-col gap-1">
          <TextField
            label={translate(messages, 'customerSelector.phone')}
            description={translate(messages, 'crm.customers.search.phoneHint')}
            value={draft.phone ?? ''}
            maxLength={MAX_PHONE_LENGTH}
            inputMode="tel"
            dir="ltr"
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                search.submit();
              }
            }}
          />
          <DigitsEcho messages={messages} value={draft.phone} />
        </div>
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
              search.submit();
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
              search.submit();
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
          onClick={search.submit}
          className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'customerSelector.search')}
        </button>
        {/* Deliberately no email box: email is not in the search allow-list, so
            a control for it could not work. Phone is, since P1-32. */}
      </div>

      {search.phase === 'idle' ? (
        <p className="text-supporting text-text-muted" lang={locale}>
          {translate(messages, 'customerSelector.idle')}
        </p>
      ) : (
        <div aria-live="polite" className="flex flex-col gap-3">
          <Results
            messages={messages}
            locale={locale}
            phase={search.phase}
            rows={search.rows}
            correlationId={search.correlationId}
            onRetry={search.submit}
            onChoose={choose}
          />

          {search.phase === 'ready' && (search.hasMore || search.pageNumber > 1) ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={search.pageNumber <= 1}
                onClick={search.previous}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'table.previousPage')}
              </button>
              <button
                type="button"
                disabled={!search.hasMore}
                onClick={search.next}
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
