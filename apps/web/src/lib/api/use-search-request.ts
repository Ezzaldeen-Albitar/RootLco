'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '../use-debounced-value';
import type { CursorPage, ReadState } from './read-operation';

/**
 * One search, run as the operator types, with the previous one abandoned.
 *
 * ## The three failures this closes, in order of how often they bite
 *
 * 1. **A superseded answer winning.** Type "Kha", type "Khal": the first read
 *    is slower and lands second, and the operator watches results for a term
 *    they have already finished replacing. A cancelled flag per effect is not
 *    enough on its own — an effect that has been cleaned up can still be racing
 *    a sibling — so every request carries a SEQUENCE number and only the latest
 *    may commit.
 * 2. **Every failure looking the same.** A refusal, an outage and a genuinely
 *    empty result are three different sentences with three different next
 *    steps, and a hook that returns `rows: []` for all three forces the screen
 *    to render "no matches" over a permission failure.
 * 3. **"No results" shown before there is an answer.** `empty` is reached only
 *    from a COMPLETED read that returned no rows. There is no state in which an
 *    in-flight request renders as an absence.
 *
 * ## What `signal` can and cannot do here
 *
 * Every read in this application goes through a Server Action, because the
 * bearer token lives in a cookie the browser cannot read. A Server Action call
 * cannot carry an `AbortSignal` across the boundary, so aborting does not stop
 * the work the server has already started — what it does, reliably, is
 * guarantee that a superseded answer is DISCARDED rather than rendered, and
 * give a loader that does reach a real `fetch` (anything under `src/lib/api`)
 * something to pass on. Both halves are stated because the weaker one is the
 * one a reader would otherwise assume.
 */

export type SearchPhase =
  /** Nothing has been asked for. No request has been made. */
  | 'idle'
  /** A request is in flight, or a keystroke has not settled yet. */
  | 'loading'
  /** Answered, with rows. */
  | 'ready'
  /** Answered, with none. Only ever reached from a completed read. */
  | 'empty'
  /** Could not be reached, timed out, or was throttled. Worth retrying. */
  | 'unavailable'
  /** The caller may not read this. Retrying cannot change it. */
  | 'refused'
  /** Anything else, including an ended session. */
  | 'failed';

export interface SearchOutcome<Row> {
  readonly phase: SearchPhase;
  readonly rows: readonly Row[];
  /** The whole page, for a screen that pages. Null until a read succeeds. */
  readonly page: CursorPage<Row> | null;
  /** A translation KEY, never server prose. Null unless the phase is a failure. */
  readonly error: string | null;
  readonly correlationId: string | null;
}

export interface SearchResult<Row> extends SearchOutcome<Row> {
  /**
   * Ask NOW, without waiting for the term to settle.
   *
   * Enter and the Search control are statements of intent, and making an
   * operator who has already decided wait out a 300 ms timer is the interface
   * being slower than the person using it. Calling it twice with the same term
   * re-issues, which is what makes it usable as a retry.
   */
  readonly submit: () => void;
}

const IDLE: SearchOutcome<never> = {
  phase: 'idle',
  rows: [],
  page: null,
  error: null,
  correlationId: null,
};

/**
 * How a read outcome becomes a phase.
 *
 * `expired` is `failed` rather than `unavailable` on purpose: the two differ in
 * what the operator must do next, and offering "try again" to somebody whose
 * session has ended is offering a button that cannot work.
 */
function outcomeOf<Row>(state: ReadState<CursorPage<Row>>): SearchOutcome<Row> {
  if (state.status === 'ok') {
    return {
      phase: state.data.items.length === 0 ? 'empty' : 'ready',
      rows: state.data.items,
      page: state.data,
      error: null,
      correlationId: state.correlationId,
    };
  }
  const phase: SearchPhase =
    state.status === 'denied'
      ? 'refused'
      : state.status === 'unavailable'
        ? 'unavailable'
        : 'failed';
  const error =
    state.status === 'denied'
      ? 'state.denied.title'
      : state.status === 'expired'
        ? 'state.expired.message'
        : state.status === 'not-found'
          ? 'state.notFound.title'
          : state.status === 'unavailable'
            ? 'state.unavailable.title'
            : 'state.error.title';
  return { phase, rows: [], page: null, error, correlationId: state.correlationId };
}

export function useSearchRequest<Row, Criteria>(options: {
  /**
   * What to ask for, or `null` for "nothing yet".
   *
   * `null` is how a screen says the operator has not expressed an intent — a
   * box with fewer characters than the backend accepts, or a form that has not
   * been touched. No request is made and the phase stays `idle`, which is what
   * makes "no request before intent" a property of this hook rather than
   * something every screen has to remember.
   */
  readonly criteria: Criteria | null;
  readonly load: (criteria: Criteria, signal: AbortSignal) => Promise<ReadState<CursorPage<Row>>>;
  /**
   * Anything outside the criteria that changes what the answer means — the
   * working-context version above all. A branch change must abandon the read in
   * flight, not let it land under the new branch's name.
   */
  readonly version?: number;
  readonly debounceMs?: number;
}): SearchResult<Row> {
  const { criteria, load, version = 0, debounceMs = SEARCH_DEBOUNCE_MS } = options;

  /*
   * The criteria, serialised.
   *
   * A screen builds its criteria inline, so the OBJECT is new on every render
   * and is useless as an effect key. Its content is not: two objects that
   * serialise the same ask for the same thing. It follows that criteria must be
   * JSON-serialisable, which they already are — every one of them becomes query
   * parameters.
   */
  const key = criteria === null ? null : JSON.stringify(criteria);
  const settledKey = useDebouncedValue(key, debounceMs);

  /*
   * An explicit submission skips the wait.
   *
   * `forced.key` is the term the operator submitted. While the box still holds
   * that term the settled value is bypassed; the moment they type again the key
   * moves on and the debounce takes over. `nonce` is what lets the same term be
   * submitted twice — pressing Search again on a failed read has to re-issue.
   */
  const [forced, setForced] = useState<{ readonly key: string; readonly nonce: number } | null>(
    null
  );
  const submitted = forced !== null && forced.key === key;
  const activeKey = submitted ? key : settledKey;
  const wanted =
    activeKey === null ? null : `${activeKey}#${version}#${submitted ? forced.nonce : 0}`;

  const submit = useCallback(() => {
    if (key === null) return;
    setForced((previous) => ({ key, nonce: (previous?.nonce ?? 0) + 1 }));
  }, [key]);

  /*
   * The criteria that produced each key, and the latest loader.
   *
   * The loader is here for the ordinary reason: it is a new function on every
   * render and would re-read on every render if it were a dependency, and
   * excluding it with a suppression would be a suppression.
   *
   * The criteria are here for a sharper reason. While the debounce lags, the
   * key being fetched is the SETTLED one and `criteria` is already the newer
   * object — so reading the current criteria at issue time fetched one thing
   * and filed the answer under the name of another. The rows would then be
   * shown the moment the debounce caught up, as if they had been read for the
   * newer term. The map hands back the criteria that the key actually names, so
   * what is fetched and what it is filed under cannot come apart.
   *
   * Bounded, because a search box generates a key per keystroke and this must
   * not grow with the session.
   */
  const box = useRef<{
    load: typeof load;
    seen: Map<string, Criteria>;
  }>({ load, seen: new Map() });
  useEffect(() => {
    box.current.load = load;
    if (key === null || criteria === null) return;
    const seen = box.current.seen;
    seen.set(key, criteria);
    while (seen.size > 8) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  });

  const sequence = useRef(0);
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly outcome: SearchOutcome<Row>;
  } | null>(null);

  useEffect(() => {
    if (wanted === null || activeKey === null) return undefined;
    const asked = box.current.seen.get(activeKey);
    if (asked === undefined) return undefined;
    const controller = new AbortController();
    sequence.current += 1;
    const mine = sequence.current;
    void (async () => {
      // Awaited before any state write, so nothing here is a synchronous
      // setState inside an effect body.
      const state = await box.current.load(asked, controller.signal);
      // Two guards, not one. The abort covers this effect being cleaned up; the
      // sequence covers a slower SIBLING request that was started earlier and is
      // still in flight.
      if (controller.signal.aborted || mine !== sequence.current) return;
      setHeld({ key: wanted, outcome: outcomeOf(state) });
    })();
    return () => controller.abort();
  }, [wanted, activeKey]);

  if (wanted === null) return { ...(IDLE as SearchOutcome<Row>), submit };
  // Loading is DERIVED — "what I am holding is not what I want" — rather than
  // written at the top of the effect, which would cascade a render on every
  // keystroke and is what `react-hooks/set-state-in-effect` exists to catch.
  if (held === null || held.key !== wanted) {
    return { phase: 'loading', rows: [], page: null, error: null, correlationId: null, submit };
  }
  return { ...held.outcome, submit };
}
