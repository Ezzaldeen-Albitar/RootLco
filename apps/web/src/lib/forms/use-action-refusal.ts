'use client';

import type { RefObject } from 'react';
import type { ActionState } from './action-result';
import { useClearOnCorrect } from './use-clear-on-correct';
import { useFocusFirstInvalid } from './use-focus-first-invalid';

/**
 * Question f for a form whose refusal comes back from a Server Action (route
 * sweep B3, Owner directive `P1-32-PRE-OD-UX`).
 *
 * `RecordForm` answers it for the forms that render through it; the
 * hand-built administration dialogs marked the refused field and stopped. This
 * is the same two hooks `RecordForm` uses, wired once: the cursor moves to the
 * first refused control after each refused attempt (`useFocusFirstInvalid`),
 * and a complaint is withdrawn once the operator edits that field
 * (`useClearOnCorrect`) — the next attempt decides afresh.
 */
export interface ActionRefusal {
  /** The ref the form element takes. */
  readonly formRef: RefObject<HTMLFormElement | null>;
  /** The complaint key for a field, until the operator edits it. */
  readonly errorKey: (field: string) => string | undefined;
  /** Call from a field's change handler. */
  readonly edited: (field: string) => void;
}

export function useActionRefusal(state: ActionState): ActionRefusal {
  const formRef = useFocusFirstInvalid(state);
  const clear = useClearOnCorrect(state);
  return { formRef, errorKey: clear.errorFor, edited: clear.noteEdited };
}
