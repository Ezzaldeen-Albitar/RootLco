'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import type { SearchPickerProps } from '@/components/search/SearchPicker';
import { MuiSearchStates } from '@/components/states/MuiStates';
import {
  useUnsavedGuard,
  useWorkingContext,
  useWorkingContextChange,
} from '@/features/working-context/WorkingContextProvider';
import { translate } from '@/i18n/get-messages';
import { useSearchRequest } from '@/lib/api/use-search-request';

/**
 * One record, found on the server and chosen by name — `SearchPicker`'s
 * contract on Material UI's `Autocomplete` (ADR-022 PR1).
 *
 * It takes EXACTLY `SearchPickerProps` (the type is shared, not copied), so a
 * call site moves by changing its import and nothing else. `SearchPicker` itself
 * is kept: the two render different accessible structures — a search box, a
 * list of match buttons and a Change control there; one combobox with a listbox
 * here — and the screens and their suites that pin the older structure move one
 * at a time rather than all at once.
 *
 * ## What is the same, rule for rule
 *
 * - **The search is the server's.** `useSearchRequest` sends one read per pause,
 *   bypasses the pause for Enter, and drops a superseded or late answer. The
 *   options are the rows the server returned, in its order: `filterOptions` is
 *   the identity, so the combobox never narrows the list on the client and
 *   passes the result off as a search.
 * - **Nothing below the minimum length is sent**, and a too-short term is said
 *   on the box (`tooShort`), which is marked invalid while it stands.
 * - **The term is typed, not rewritten.** Arabic-Indic digits and every other
 *   character go to the server as typed (trimmed at the ends); the backend folds
 *   digits when it matches.
 * - **A working-context switch forgets the term and the choice.** The term
 *   remembers the version it was typed under, so the render on which the
 *   version moves already treats an old term as empty; the choice is cleared by
 *   `useWorkingContextChange`, and a choice in a form that writes asks first
 *   (`countsAsUnsaved`, `pristineId` — putting back the record the form opened
 *   with is a change too).
 * - **Permission-aware.** Without `canSearch` there is no box, and the reason is
 *   a sentence with `unavailableId`, which a caller may describe a disabled
 *   submit with. A record already held is still shown, read-only, above that
 *   sentence: the operator may not look records up, not "nothing is chosen".
 * - **Errors are the field's own.** The caller's refusal marks the combobox
 *   (`aria-invalid`, `data-invalid`, described by the sentence, which is its own
 *   `role="alert"`) whether or not something is chosen — the combobox role, unlike
 *   the button the older picker used, supports `aria-invalid` — so
 *   `useFocusFirstInvalid` lands on it and the refusal is gone once the caller
 *   withdraws it.
 * - **It is not a form.** Enter with no option highlighted searches now; it never
 *   submits the caller's form with nothing chosen. Enter on a highlighted option
 *   chooses it. Every button is `type="button"`.
 * - **Choosing keeps the cursor** on the combobox, which now reads the chosen
 *   record's name. `change` names the control that puts the choice back — a
 *   real, always-visible button next in the tab order, not Material's clear
 *   icon, which shows only on hover or focus and is out of the tab order.
 *   Escape on the box still clears.
 * - **Every non-answer reads as itself** — loading, no matches, unavailable
 *   with a retry, refused, ended session — through `MuiSearchStates` under the
 *   box, each its own `role="status"`. The list opens only on an answer with
 *   rows, so "Loading" is said once, there, and never again inside the list.
 * - **Pages are the server's.** When the server says more exist, Previous and
 *   Next walk the cursor stack and reopen the list.
 */
export function EntityPicker<Row extends { readonly id: string }>({
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
  describedBy,
  testId,
}: SearchPickerProps<Row>) {
  const base = useId();
  const boxId = `${base}-box`;
  const errorId = `${base}-error`;
  const exampleId = `${base}-example`;

  const chosenId = `${base}-chosen`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);

  const context = useWorkingContext();
  const [typed, setTyped] = useState(() => ({ text: '', version: context.version }));
  const term = typed.version === context.version ? typed.text : '';
  const setTerm = (text: string) => setTyped({ text, version: context.version });

  useUnsavedGuard(countsAsUnsaved && (value?.id ?? null) !== pristineId);

  useWorkingContextChange(() => {
    setTerm('');
    setOpen(false);
    if (value !== null) onChange(null);
  });

  /*
   * The cursor after a press, for exactly the one commit the press produced —
   * `SearchPicker`'s rule. A caller may refuse the choice; the request to keep
   * the cursor ends with the press either way, so a record the caller sets
   * LATER never pulls the cursor from where the operator has gone since.
   */
  const focusChosen = useRef(false);
  const [pressed, setPressed] = useState(0);
  useEffect(() => {
    if (!focusChosen.current) return;
    focusChosen.current = false;
    if (value !== null) inputRef.current?.focus();
  }, [value, pressed]);

  const trimmed = term.trim();
  const short = trimmed.length > 0 && trimmed.length < minLength;
  const criteria = canSearch && value === null && trimmed.length >= minLength ? trimmed : null;

  const search = useSearchRequest<Row, string>({
    criteria,
    load: (asked, cursor, signal) => load(asked, cursor, signal),
    version: context.version,
  });

  const shownError = short ? tooShort : error;
  const invalid = Boolean(shownError);

  if (!canSearch) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        <span id={`${base}-label`} className="text-label font-medium text-text-primary">
          {label}
        </span>
        {value !== null ? (
          // What the form holds, read-only: without the read there is no way to
          // choose another, so no control is offered to put this one back.
          <div
            role="group"
            aria-labelledby={`${base}-label`}
            className="rounded-md border border-border bg-surface-subtle px-3 py-2"
          >
            <bdi
              id={chosenId}
              className="text-body text-text-primary"
              data-testid={testId ? `${testId}-chosen` : undefined}
            >
              {labelOf(value)}
            </bdi>
          </div>
        ) : null}
        <p id={unavailableId} role="status" className="text-supporting text-text-secondary">
          {notPermitted}
        </p>
        {error ? (
          <p id={errorId} role="alert" className="text-supporting text-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  // The chosen record is always among the options, so Material never sees a
  // value its list cannot name. No search is made while one is chosen.
  const listed: readonly Row[] =
    value !== null ? [value] : search.phase === 'ready' ? search.rows : [];
  const describedByIds =
    [example ? exampleId : undefined, invalid ? errorId : undefined, describedBy]
      .filter(Boolean)
      .join(' ') || undefined;

  const reopen = () => {
    setOpen(true);
    inputRef.current?.focus();
  };

  const putBack = () => {
    onChange(null);
    setTerm('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {/* `boolean` for the clear flag: the value may still be null. */}
      <Autocomplete<Row, false, boolean, false>
        id={boxId}
        options={listed}
        value={value}
        inputValue={value !== null ? labelOf(value) : term}
        // Only an answer with rows opens the list. Loading and "no matches"
        // are said once, by the state under the box, never again in the list.
        open={open && search.phase === 'ready'}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        // The server's list, in the server's order. Never narrowed here.
        filterOptions={(options) => options}
        getOptionLabel={labelOf}
        isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
        onInputChange={(_, next, reason) => {
          // Only what the operator TYPED is a term. Material also reports the
          // chosen label ('reset', 'selectOption') and a blur; the box shows
          // the choice from `value`, so those are not searches.
          if (reason === 'clear') {
            setTerm('');
            return;
          }
          if (reason !== 'input') return;
          if (value !== null) onChange(null);
          setTerm(next);
          setOpen(true);
        }}
        onChange={(_, next) => {
          if (next === null) {
            onChange(null);
            setTerm('');
            return;
          }
          focusChosen.current = true;
          setPressed((count) => count + 1);
          onChange(next);
          setTerm('');
          setOpen(false);
        }}
        onKeyDown={(
          event: KeyboardEvent<HTMLDivElement> & { defaultMuiPrevented?: boolean | undefined }
        ) => {
          if (event.key !== 'Enter') return;
          // A highlighted option is Material's to choose. Material marks it on
          // the input as the active descendant, and clears the mark when none is.
          if (inputRef.current?.getAttribute('aria-activedescendant')) return;
          // Otherwise Enter is "search now" — and never the caller's submit.
          event.preventDefault();
          event.defaultMuiPrevented = true;
          if (criteria !== null) {
            search.submit();
            setOpen(true);
          }
        }}
        // The explicit Change button below replaces the hover-only clear icon.
        disableClearable
        clearOnEscape
        handleHomeEndKeys
        slotProps={{
          // Named by what it lists, not by the question the box asks.
          listbox: { 'aria-label': resultsLabel, 'aria-labelledby': undefined },
        }}
        renderOption={(props, row) => {
          const { key, ...rest } = props;
          return (
            <li key={key} {...rest}>
              <bdi>{labelOf(row)}</bdi>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            inputRef={inputRef}
            label={label}
            placeholder={placeholder}
            error={invalid}
            helperText={
              shownError ? (
                <span id={errorId} role="alert">
                  {shownError}
                </span>
              ) : undefined
            }
            slotProps={{
              ...params.slotProps,
              htmlInput: {
                ...params.slotProps.htmlInput,
                maxLength,
                // Mirrors `FieldFrame`: present only when true.
                'aria-invalid': invalid || undefined,
                'data-invalid': invalid ? 'true' : undefined,
                'aria-describedby': describedByIds,
                'aria-errormessage': invalid ? errorId : undefined,
              },
              formHelperText: { component: 'div' },
            }}
          />
        )}
      />
      {value !== null ? (
        <div>
          <Button type="button" size="small" variant="outlined" onClick={putBack}>
            {change}
          </Button>
        </div>
      ) : null}
      {example ? (
        <p id={exampleId} className="text-caption text-text-muted">
          {example}
        </p>
      ) : null}
      {search.phase === 'idle' || search.phase === 'ready' ? null : (
        <div>
          <MuiSearchStates
            messages={messages}
            locale={locale}
            phase={search.phase}
            correlationId={search.correlationId}
            onRetry={
              search.phase === 'unavailable' || search.phase === 'failed'
                ? () => {
                    search.submit();
                    setOpen(true);
                  }
                : undefined
            }
          />
        </div>
      )}
      {search.phase === 'ready' && value === null && (search.hasMore || search.pageNumber > 1) ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="small"
            variant="outlined"
            disabled={search.pageNumber <= 1}
            onClick={() => {
              search.previous();
              reopen();
            }}
          >
            {translate(messages, 'table.previousPage')}
          </Button>
          <Button
            type="button"
            size="small"
            variant="outlined"
            disabled={!search.hasMore}
            onClick={() => {
              search.next();
              reopen();
            }}
          >
            {translate(messages, 'table.nextPage')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The adapter: `EntityPicker` under `SearchPicker`'s name, with its props.
 *
 * A call site of `@/components/search/SearchPicker` switches to Material UI by
 * importing `SearchPicker` from this module instead — nothing else in the call
 * changes. Its suite must then find a combobox and options rather than a box
 * and match buttons.
 */
export { EntityPicker as SearchPicker };
