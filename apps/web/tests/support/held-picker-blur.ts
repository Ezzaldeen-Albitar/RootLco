import { act } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';

/**
 * Holds back the date picker's delayed blur update until `release()` is called.
 *
 * When the cursor leaves a picker field, the picker does not record the loss of
 * focus at once: its blur handler schedules a zero-delay timer, and only that
 * timer tells the picker it is no longer focused. Normally the timer runs long
 * before a refused form puts the cursor back, so the picker sees a fresh focus,
 * re-renders, and selects the part it enters. On a loaded runner the refusal
 * can arrive first; the picker then still believes it holds focus on that same
 * part, nothing it tracks changes, and it never selects the part's text.
 *
 * This makes that order certain instead of a matter of load. Every zero-delay
 * timer scheduled while a `focusout` from inside `field` is being dispatched is
 * kept back — the document's capture listener opens the window before React's
 * delegated handler runs, and its bubble listener closes it after — and is run,
 * inside `act`, only when `release()` is called; `release()` answers how many
 * it ran, so a case can show the hold took effect. Every other timer runs as
 * usual. The interception is undone when `release()` runs or, at the latest,
 * when the test finishes, so a failing case cannot leak it into the next one.
 */
export function holdPickerBlur(field: HTMLElement): () => number {
  const held: (() => void)[] = [];
  let leaving = false;
  const onLeaveStart = (event: FocusEvent) => {
    if (event.target instanceof Node && field.contains(event.target)) leaving = true;
  };
  const onLeaveEnd = () => {
    leaving = false;
  };
  const realSetTimeout = globalThis.setTimeout;
  const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: unknown,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (leaving && typeof handler === 'function' && (timeout ?? 0) === 0) {
      held.push(() => (handler as (...rest: unknown[]) => void)(...args));
      return 0;
    }
    return (realSetTimeout as (...rest: unknown[]) => unknown)(handler, timeout, ...args);
  }) as unknown as typeof setTimeout);
  document.addEventListener('focusout', onLeaveStart, true);
  document.addEventListener('focusout', onLeaveEnd);

  let undone = false;
  const undo = () => {
    if (undone) return;
    undone = true;
    document.removeEventListener('focusout', onLeaveStart, true);
    document.removeEventListener('focusout', onLeaveEnd);
    timers.mockRestore();
  };
  onTestFinished(undo);

  return function release() {
    undo();
    const due = held.splice(0);
    act(() => {
      for (const run of due) run();
    });
    return due.length;
  };
}
