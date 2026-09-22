'use client';

import { useState } from 'react';
import type { ActionState } from './action-result';

/**
 * A field's error goes away when the operator fixes it, not when they submit.
 *
 * ## The failure this closes
 *
 * A save is refused, three fields are marked, the operator corrects the first —
 * and it stays red. So do the other two, and the form keeps saying three things
 * are wrong while the operator has no way to tell which of them still are. The
 * only way to find out is to submit again and spend another request, which is
 * the opposite of what the marks are for.
 *
 * ## Why it clears rather than re-validates
 *
 * The server is the authority on whether a value is acceptable, and this cannot
 * ask it without sending the form. So it does not claim the new value is
 * VALID — it stops claiming the OLD complaint still applies, which is the only
 * honest statement available: the sentence was about a value that is no longer
 * there.
 *
 * A cleared error returns on the next submission if the server refuses again,
 * and the whole set resets whenever a new attempt arrives — so a correction can
 * never hide a fresh complaint about the same field.
 */
export interface ClearOnCorrect {
  /** The error key for a control, or undefined once the operator has edited it. */
  readonly errorFor: (field: string) => string | undefined;
  /** Call from a control's `onChange`. */
  readonly noteEdited: (field: string) => void;
  /** True while at least one server complaint is still standing. */
  readonly hasStandingErrors: boolean;
}

export function useClearOnCorrect(state: ActionState): ClearOnCorrect {
  const attempt = state.attempt ?? 0;
  const [edited, setEdited] = useState<readonly string[]>([]);
  const [lastAttempt, setLastAttempt] = useState(attempt);

  /*
   * Reset DURING render rather than in an effect — React's documented shape for
   * "reset state when an input changes", and the one `use-server-table` already
   * uses. An effect would render one frame in which the previous attempt's
   * cleared set was applied to the NEW attempt's errors, which is exactly the
   * case where a fresh complaint would be invisible.
   */
  if (attempt !== lastAttempt) {
    setLastAttempt(attempt);
    setEdited([]);
  }

  const fieldErrors = state.fieldErrors;
  const standing = Object.keys(fieldErrors ?? {}).filter((name) => !edited.includes(name));

  return {
    errorFor: (field) =>
      edited.includes(field) ? undefined : (fieldErrors?.[field] ?? undefined),
    noteEdited: (field) =>
      setEdited((current) => (current.includes(field) ? current : [...current, field])),
    hasStandingErrors: standing.length > 0,
  };
}
