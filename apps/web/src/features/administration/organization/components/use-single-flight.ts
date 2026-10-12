'use client';

import { useRef, useState } from 'react';

/**
 * One write at a time, for the Organisation screen's forms and dialogs
 * (P1-32-PRE-OD-ADM1).
 *
 * A disabled button is not enough on its own: two presses delivered before
 * React renders again — a double click, or Enter held on the button — both
 * reach the handler while the button still reads enabled. The ref is set
 * synchronously by the first press, so the second finds it set and does
 * nothing; it is cleared when the write has answered, whatever the answer.
 * `pending` is what the button shows meanwhile.
 *
 * Deliberately not an async transition: the screen keeps rendering normally
 * while the write is out (a re-read of the page, a branch switch), and the
 * answer is applied as an ordinary update when it arrives.
 */
export function useSingleFlight(): {
  readonly pending: boolean;
  readonly run: (work: () => Promise<void>) => boolean;
} {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const run = (work: () => Promise<void>): boolean => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    void (async () => {
      try {
        await work();
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
    return true;
  };
  return { pending, run };
}
