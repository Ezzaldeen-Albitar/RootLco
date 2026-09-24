'use client';

import { useState, type RefObject } from 'react';
import type { ActionState } from './action-result';
import { useFocusFirstInvalid } from './use-focus-first-invalid';

/**
 * A form's own refusal, before anything is sent — with the cursor moved to the
 * first thing to fix and each complaint withdrawn once its value changes
 * (route sweep B3, Owner directive `P1-32-PRE-OD-UX`, question f).
 *
 * ## The gap it closes
 *
 * The hand-built forms on the pricing and quotation screens checked their
 * fields, marked the wrong ones and stopped. The cursor stayed on the submit
 * button, and a corrected field kept its complaint until the next submit —
 * the two halves of question f that `RecordForm` already answers through
 * `useFocusFirstInvalid` and `useClearOnCorrect`.
 *
 * ## How "corrected" is decided
 *
 * The caller passes the CURRENT value of every field it can complain about.
 * The values at the moment of the refusal are kept, and a complaint is shown
 * only while its field still holds the value it was about. That needs no
 * change handler on any control, so a composite control — a branch pair, a
 * money field, a line of a quotation — withdraws its complaint the same way a
 * text box does. It does not claim the new value is valid: the next submit
 * decides that, and complains again if it must.
 */
export interface LocalRefusal {
  /** The ref the form element takes, so the cursor can be moved inside it. */
  readonly formRef: RefObject<HTMLFormElement | null>;
  /** Records the complaints found by the form's own checks; empty clears them. */
  readonly refuse: (found: Readonly<Record<string, string>>) => void;
  /** The complaint for a field, while its value is still the one refused. */
  readonly errorKey: (field: string) => string | undefined;
  /** Every complaint still standing, keyed by field — for an editor of many rows. */
  readonly errors: Readonly<Record<string, string>>;
}

interface Held {
  readonly state: ActionState;
  readonly seen: Readonly<Record<string, string>>;
}

export function useLocalRefusal(values: Readonly<Record<string, string>>): LocalRefusal {
  const [held, setHeld] = useState<Held>({ state: { status: 'idle' }, seen: {} });
  const formRef = useFocusFirstInvalid(held.state);
  const standing = (field: string): boolean => values[field] === held.seen[field];
  const errors = Object.fromEntries(
    Object.entries(held.state.fieldErrors ?? {}).filter(([field]) => standing(field))
  );
  return {
    errors,
    formRef,
    refuse: (found) => {
      const snapshot = { ...values };
      setHeld((previous) =>
        Object.keys(found).length === 0
          ? { state: { status: 'idle', attempt: previous.state.attempt ?? 0 }, seen: snapshot }
          : {
              state: {
                status: 'invalid',
                fieldErrors: { ...found },
                attempt: (previous.state.attempt ?? 0) + 1,
              },
              seen: snapshot,
            }
      );
    },
    errorKey: (field) => {
      const key = held.state.fieldErrors?.[field];
      if (key === undefined) return undefined;
      return standing(field) ? key : undefined;
    },
  };
}

/**
 * The same rule for a refusal that comes back from a write — the console's
 * dialogs, whose controls are held in state rather than in the form's DOM.
 *
 * The values at the moment the refusal arrived are kept; a complaint stands
 * while its field still holds that value, and a field the caller does not
 * pass stays complained about until the next attempt.
 */
export interface StateRefusal {
  readonly formRef: RefObject<HTMLFormElement | null>;
  readonly errors: Readonly<Record<string, string>>;
}

export function useStateRefusal(
  state: ActionState,
  values: Readonly<Record<string, string>>
): StateRefusal {
  const formRef = useFocusFirstInvalid(state);
  const attempt = state.attempt ?? 0;
  const [seen, setSeen] = useState<{
    readonly attempt: number;
    readonly values: Readonly<Record<string, string>>;
  }>({ attempt, values: { ...values } });
  // Taken during render when a new attempt lands — React's pattern for state
  // that follows a value — so no frame shows a fresh complaint as withdrawn.
  if (seen.attempt !== attempt) setSeen({ attempt, values: { ...values } });
  const errors = Object.fromEntries(
    Object.entries(state.fieldErrors ?? {}).filter(
      ([field]) => !(field in values) || values[field] === seen.values[field]
    )
  );
  return { formRef, errors };
}

/**
 * The same rule for a form that keeps its complaints in a state of its own —
 * `setFieldErrors(...)` after its own checks or after a write's answer. Every
 * new non-empty set of complaints is an attempt: the cursor moves to its first
 * field, and each complaint stands while its field holds the value it had then.
 */
export function useHeldRefusal(
  fieldErrors: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>
): StateRefusal {
  // A new set of complaints is a new attempt; the values are taken with it by
  // `useStateRefusal`.
  const [held, setHeld] = useState<{
    readonly errors: Readonly<Record<string, string>>;
    readonly attempt: number;
  }>({ errors: fieldErrors, attempt: 0 });
  if (held.errors !== fieldErrors) {
    setHeld({
      errors: fieldErrors,
      attempt: Object.keys(fieldErrors).length > 0 ? held.attempt + 1 : held.attempt,
    });
  }
  return useStateRefusal(
    {
      status: Object.keys(fieldErrors).length > 0 ? 'invalid' : 'idle',
      fieldErrors,
      attempt: held.attempt,
    },
    values
  );
}
