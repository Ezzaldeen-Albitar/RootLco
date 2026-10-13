'use client';

import { useCallback, useRef } from 'react';

/**
 * The catalogue key for a date and time only partly typed.
 *
 * One sentence for every form that takes a moment and has no wording of its own
 * for this case. A partly typed moment holds no value — the field's value stays
 * `''`, exactly as for a field nobody touched — so a form that checks the value
 * alone answers "This field is required." to an operator who has typed most of
 * it. The field itself knows better and says so through `onProblem`
 * (`'incomplete'`, `components/forms/mui/DateField.tsx`); this is the sentence
 * that answer is given.
 */
export const INCOMPLETE_DATE_TIME_KEY = 'field.dateTimeIncomplete';

/**
 * Which of a form's date-and-time fields are partly typed right now.
 *
 * `noteProblem(name)` is handed to the field as its `onProblem`; `isUnfinished`
 * answers at submit time. Nothing is drawn from it, so it is held in a ref
 * rather than in state: no render is spent on it, and a submit that runs from a
 * closure created before the last render — a Server Action form's
 * `useActionState` callback — still reads what the fields last reported.
 */
export function useUnfinishedEntries(): {
  readonly isUnfinished: (name: string) => boolean;
  readonly noteProblem: (name: string) => (problem: string | null) => void;
  /** Forgets every report — for a form that is emptied or closed. */
  readonly reset: () => void;
} {
  const current = useRef<Readonly<Record<string, boolean>>>({});

  const noteProblem = useCallback(
    (name: string) => (problem: string | null) => {
      current.current = { ...current.current, [name]: problem === 'incomplete' };
    },
    []
  );
  const isUnfinished = useCallback((name: string) => current.current[name] === true, []);
  const reset = useCallback(() => {
    current.current = {};
  }, []);

  return { isUnfinished, noteProblem, reset };
}
