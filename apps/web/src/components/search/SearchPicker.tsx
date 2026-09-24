'use client';

import { useId, useState } from 'react';

import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import {
  useUnsavedGuard,
  useWorkingContext,
  useWorkingContextChange,
} from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';

/**
 * One record, FOUND by what a person holds and chosen by name — never typed as
 * a reference (Owner directive, `P1-32-PRE-OD-UX`).
 *
 * `WorkOrderPicker` settled the shape on the quotation builder and the invoice
 * desk; the payment desk, the invoice payer and the quotation's requester need
 * the same one over different reads. This is that shape once, so a customer, an
 * invoice and a colleague are chosen the same way everywhere they are chosen:
 *
 * - **The search is the server's, and it never reaches the address.**
 *   `useSearchRequest` sends one read per pause and drops a superseded answer;
 *   the term lives in memory only.
 * - **A working-context switch forgets the term and the choice**, asking first
 *   when something was chosen inside a form that writes (`countsAsUnsaved`; a
 *   list filter forgets without asking): every change of the working context increments
 *   `version`, and the term remembers the version it was typed under, so the
 *   render on which the version moves already treats an old term as empty.
 * - **Permission-aware.** Without the read's code the picker offers no box and
 *   says why, in a sentence whose id the caller may point a disabled submit at.
 * - **Errors are the field's own.** The caller's refusal lands on the box
 *   (`aria-invalid`, described by the sentence) or, once something is chosen,
 *   on the control that changes it — so `useFocusFirstInvalid` moves the cursor
 *   to the thing to fix, and the refusal disappears once it is corrected.
 * - **It is not a `<form>`.** Every button is `type="button"`, and Enter in the
 *   box searches rather than submitting the caller's form with nothing chosen.
 */
export function SearchPicker<Row extends { readonly id: string }>({
  messages,
  locale,
  label,
  value,
  onChange,
  labelOf,
  load,
  canSearch,
  notPermitted,
  unavailableId,
  error,
  minLength,
  maxLength,
  placeholder,
  example,
  tooShort,
  resultsLabel,
  change,
  pristineId = null,
  countsAsUnsaved = true,
  testId,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  /** The question this picker asks. */
  readonly label: string;
  /** The chosen record, or null. */
  readonly value: Row | null;
  readonly onChange: (next: Row | null) => void;
  /** What a person recognises the record by. Never its identifier. */
  readonly labelOf: (row: Row) => string;
  /** One page of the read for a term already long enough to send. */
  readonly load: (term: string, cursor: string | null) => Promise<ReadState<CursorPage<Row>>>;
  /** Whether the read can be answered at all for this caller. */
  readonly canSearch: boolean;
  /** Why there is no box, when `canSearch` is false. */
  readonly notPermitted: string;
  /** The id given to that sentence, so a caller can describe a disabled submit with it. */
  readonly unavailableId?: string | undefined;
  /** The caller's own refusal — nothing chosen yet, for instance. */
  readonly error?: string | undefined;
  readonly minLength: number;
  readonly maxLength: number;
  readonly placeholder: string;
  readonly example: string;
  /** Said on the box while the term is shorter than the read accepts. */
  readonly tooShort: string;
  /** The accessible name of the list of matches. */
  readonly resultsLabel: string;
  /** The words on the control that puts a choice back. */
  readonly change: string;
  /**
   * The id of a choice the form OPENED with (a payer taken from the work
   * order, for instance). Holding it is not unsaved work; changing it is.
   */
  readonly pristineId?: string | null;
  /**
   * Whether a choice is work the operator would lose. True for a picker inside a
   * form that writes; a LIST FILTER passes false, because narrowing a list is
   * not something a branch switch should stop to ask about.
   */
  readonly countsAsUnsaved?: boolean;
  readonly testId: string;
}) {
  const base = useId();
  const errorId = `${base}-error`;
  const context = useWorkingContext();
  const [typed, setTyped] = useState(() => ({ text: '', version: context.version }));
  const term = typed.version === context.version ? typed.text : '';
  const setTerm = (text: string) => setTyped({ text, version: context.version });

  // A chosen record in a write form is work the operator would lose: a branch
  // switch asks first. A filter's choice is not.
  useUnsavedGuard(countsAsUnsaved && value !== null && value.id !== pristineId);

  // Forget the choice and the term when the working context changes.
  useWorkingContextChange(() => {
    setTerm('');
    if (value !== null) onChange(null);
  });

  const trimmed = term.trim();
  const short = trimmed.length > 0 && trimmed.length < minLength;
  const criteria = canSearch && value === null && trimmed.length >= minLength ? trimmed : null;

  const search = useSearchRequest<Row, string>({
    criteria,
    load: (asked, cursor) => load(asked, cursor),
    version: context.version,
  });

  const heading = (
    <span id={`${base}-label`} className="text-label font-medium text-text-primary">
      {label}
    </span>
  );
  const refusal = error ? (
    <p id={errorId} role="alert" className="text-supporting text-error">
      {error}
    </p>
  ) : null;

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        {heading}
        <div
          aria-labelledby={`${base}-label`}
          role="group"
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2"
        >
          <bdi className="text-body text-text-primary" data-testid={`${testId}-chosen`}>
            {labelOf(value)}
          </bdi>
          <button
            type="button"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onClick={() => {
              onChange(null);
              setTerm('');
            }}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {change}
          </button>
        </div>
        {refusal}
      </div>
    );
  }

  if (!canSearch) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        {heading}
        <p id={unavailableId} role="status" className="text-supporting text-text-secondary">
          {notPermitted}
        </p>
        {refusal}
      </div>
    );
  }

  const retry = (
    <button
      type="button"
      onClick={search.submit}
      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {translate(messages, 'state.retry')}
    </button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <SearchBox
        messages={messages}
        label={label}
        placeholder={placeholder}
        example={example}
        value={term}
        onChange={setTerm}
        onSubmit={search.submit}
        busy={search.phase === 'loading'}
        maxLength={maxLength}
        error={short ? tooShort : error}
        testId={`${testId}-search`}
      />
      {search.phase === 'idle' ? null : (
        <div aria-live="polite" className="flex flex-col gap-3">
          {search.phase !== 'ready' ? (
            <SearchStates
              messages={messages}
              locale={locale}
              phase={search.phase}
              correlationId={search.correlationId}
              {...(search.phase === 'unavailable' || search.phase === 'failed' ? { retry } : {})}
            />
          ) : (
            <ul
              aria-label={resultsLabel}
              className="flex flex-col divide-y divide-border rounded-md border border-border"
            >
              {search.rows.map((row) => (
                <li key={row.id}>
                  <button
                    // Choosing a record must not submit the caller's form.
                    type="button"
                    onClick={() => {
                      onChange(row);
                      setTerm('');
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <bdi>{labelOf(row)}</bdi>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
