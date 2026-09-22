'use client';

import { useId, type KeyboardEvent } from 'react';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * One box, one question.
 *
 * ## Why the page supplies the words
 *
 * A search box is only usable when the operator knows what may be typed into
 * it, and that is different on every screen: a customer search takes a name, a
 * number or a phone; a vehicle search takes a plate or a chassis number. The
 * label, the placeholder and the EXAMPLE are the page's, because a generic
 * "Search…" is the shape of a control rather than a question anybody can answer.
 *
 * The example is a separate line rather than placeholder text. Placeholder text
 * disappears the moment the operator starts typing, which is exactly when they
 * are most likely to want to check the format, and a placeholder is not a
 * reliable accessible description.
 *
 * ## Arabic-Indic digits are accepted, not corrected
 *
 * An operator typing on an Arabic keyboard produces ٠١٢٣, and nothing here
 * rejects, rewrites or filters them. What is typed is what is sent; the backend
 * folds digits when it matches. `inputMode` is deliberately NOT `numeric` — a
 * box that takes a name, a number or a phone must not summon a digits-only
 * keypad on a phone and make the name impossible to type.
 *
 * ## Enter submits, Escape clears
 *
 * Both are what a keyboard user already expects, and neither is available for
 * free: this control is used inside `<form onSubmit>` on some screens and
 * outside a form on others, so Enter is handled here rather than relying on
 * implicit submission that only exists in one of the two.
 */
export function SearchBox({
  messages,
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  example,
  busy = false,
  autoFocus = false,
  error,
  maxLength,
  inlineSubmit = true,
  testId = 'search-box',
}: {
  readonly messages: Messages;
  /** The question this box asks. Never generic — see the docblock. */
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Called on Enter and on the search control. Optional for a live search. */
  readonly onSubmit?: (() => void) | undefined;
  readonly placeholder?: string | undefined;
  /** What a valid entry looks like on THIS screen. Shown, not hinted. */
  readonly example?: string | undefined;
  readonly busy?: boolean;
  readonly autoFocus?: boolean;
  /**
   * A refusal about what was typed — a term the backend is known to reject, for
   * instance. Carried here rather than beside the box so the control is marked
   * invalid as well as described, which is what `useFocusFirstInvalid` finds.
   */
  readonly error?: string | undefined;
  readonly maxLength?: number | undefined;
  /**
   * Whether the box carries its own search control.
   *
   * A screen that already has a Search button of its own passes `false`: two
   * controls with the same name on one form are two things for a keyboard user
   * to disambiguate and two ways for a test to find the wrong one. `onSubmit`
   * is still honoured — Enter is handled here in both cases, because this box
   * is used outside a form on some surfaces and implicit submission does not
   * exist there.
   */
  readonly inlineSubmit?: boolean;
  readonly testId?: string;
}) {
  const base = useId();
  const inputId = `${base}-search`;
  const exampleId = example ? `${base}-example` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [exampleId, errorId].filter(Boolean).join(' ') || undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Prevented even when there is no `onSubmit`: inside a form, the default
      // would submit the surrounding form, which is a different action.
      event.preventDefault();
      onSubmit?.();
      return;
    }
    if (event.key === 'Escape' && value.length > 0) {
      event.preventDefault();
      onChange('');
    }
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <label htmlFor={inputId} className="text-label font-medium text-text-primary">
        {label}
      </label>
      <div className="relative flex items-center">
        {/*
          No leading glyph. `Icon` publishes a fixed set of names and none of
          them is a magnifier; inventing one would render nothing at all and
          every test would still pass. The label above the box is what says what
          this control is, and it says it to everybody.
        */}
        <input
          id={inputId}
          type="search"
          // Not `numeric`: this box takes a name as readily as a number.
          inputMode="text"
          dir="auto"
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-errormessage={errorId}
          aria-busy={busy || undefined}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 w-full rounded-md border border-border bg-surface ps-3 pe-20 text-body text-text-primary transition-colors duration-fast ease-standard placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        />
        <div className="absolute end-1 flex items-center gap-1">
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label={translate(messages, 'search.clear')}
              className="rounded-md px-2 py-1 text-supporting text-text-secondary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          ) : null}
          {onSubmit && inlineSubmit ? (
            <button
              type="button"
              onClick={onSubmit}
              className="rounded-md px-2 py-1 text-supporting font-medium text-primary transition-colors duration-fast ease-standard hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {translate(messages, 'search.submit')}
            </button>
          ) : null}
        </div>
      </div>
      {example ? (
        <p id={exampleId} className="text-supporting text-text-muted">
          {example}
        </p>
      ) : null}
      {error ? (
        // The same shape-and-colour cue every other field carries.
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-supporting text-error"
        >
          <span
            aria-hidden="true"
            className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-error text-caption font-bold leading-none"
          >
            !
          </span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
