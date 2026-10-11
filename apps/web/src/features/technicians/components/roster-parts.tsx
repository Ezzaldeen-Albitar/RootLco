'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

/**
 * Pieces the roster and the profile share (`P1-32-PRE-OD-ADM2B`): how a person
 * is named, how a refusal is said, how a write is sent once, and how a draft
 * counts as unsaved work.
 */

/** The person a roster row belongs to, in words: their name, or why it is not shown. */
export function technicianName(
  messages: Messages,
  entry: { readonly displayName: string | null }
): string {
  return entry.displayName ?? translate(messages, 'technicians.roster.nameWithheld');
}

/**
 * Why the last attempt was refused, in a sentence for beside the buttons — or
 * nothing while there is no refusal. A field refusal keeps its own sentence on
 * its field; the banner then says the form needs attention.
 */
export function refusalSentence(messages: Messages, outcome: ActionState): string | undefined {
  if (outcome.status === 'idle' || outcome.status === 'success' || outcome.status === 'cancelled') {
    return undefined;
  }
  if (outcome.status === 'invalid') {
    return outcome.messageKey ? translateDynamic(messages, outcome.messageKey) : undefined;
  }
  return translateWithValues(
    messages,
    outcome.messageKey ?? 'admin.actionFailed',
    outcome.messageValues
  );
}

/**
 * One write at a time: a ref that is set before the button can be disabled, so
 * a second press in the same tick sends nothing.
 */
export function useOneWrite(): {
  readonly running: boolean;
  readonly run: (task: () => Promise<ActionState>) => Promise<ActionState | null>;
} {
  const sending = useRef(false);
  const [running, setRunning] = useState(false);
  const run = useCallback(async (task: () => Promise<ActionState>) => {
    if (sending.current) return null;
    sending.current = true;
    setRunning(true);
    let outcome: ActionState;
    try {
      outcome = await task();
    } catch {
      // No answer came back: what was entered stays, and the button works again.
      outcome = { status: 'unavailable', messageKey: 'state.unavailable.message', attempt: 1 };
    } finally {
      sending.current = false;
      setRunning(false);
    }
    return outcome;
  }, []);
  return { running, run };
}

/**
 * Registers a dialog's draft as unsaved work: anything typed and not yet saved
 * holds a change of the working branch until the operator answers, and a
 * confirmed discard closes the dialog.
 */
export function UnsavedWork({
  dirty,
  onDiscard,
}: {
  readonly dirty: boolean;
  readonly onDiscard: () => void;
}) {
  useUnsavedGuard(dirty, onDiscard);
  return null;
}

/** A labelled value of a definition list. */
export function DetailRow({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label font-medium text-text-secondary">{term}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}
