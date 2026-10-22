'use client';

import { useEffect, useState } from 'react';

/**
 * A value that settles after the operator stops changing it.
 *
 * ## Why a debounce is FEWER requests here, not more
 *
 * Two screens in this product record "there is no debounce, because a debounce
 * is still a request per pause", and choose an explicit Search button instead.
 * The first half of that sentence is true and the conclusion does not follow.
 * The comparison that matters is not "debounced typing versus nothing"; it is
 * "debounced typing versus what the operator actually does", and what they
 * actually do is type a few characters, press Search, read, correct the
 * spelling, press Search again. That is one request per attempt with no upper
 * bound and no cancellation.
 *
 * A 300 ms debounce sends one request per PAUSE and cancels the one before it,
 * so a name typed in one go is a single request — fewer than the three or four
 * a hunt-and-correct search spends. The rate limit that argument was built on
 * (`expensive-read`: 30 requests per 60 seconds, keyed by operation, workspace
 * and user) is protected by the same mechanism, from the other direction.
 *
 * 300 ms is the interval, and it is a judgement rather than a measurement: long
 * enough that ordinary typing does not cross it, short enough that a pause
 * reads as instant. It is a parameter so a screen with a more expensive read
 * can lengthen it without forking this file.
 *
 * ## Why the value is state and not a ref
 *
 * The settled value is rendered — a screen reads it to decide what to ask for —
 * so it has to cause a render when it changes. A ref would update silently and
 * the screen would keep asking for the previous value.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Already settled: no timer, and — just as important — no state write, so
    // this effect cannot cascade.
    if (Object.is(settled, value)) return undefined;
    const timer = setTimeout(() => setSettled(value), delayMs);
    // Every keystroke clears the previous timer, which is what makes this one
    // request per pause rather than one per character.
    return () => clearTimeout(timer);
  }, [value, delayMs, settled]);

  return settled;
}

/** The interval every search box in this product shares. */
export const SEARCH_DEBOUNCE_MS = 300;
